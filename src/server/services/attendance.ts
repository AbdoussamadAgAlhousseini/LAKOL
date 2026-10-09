import "server-only";
import type { AttendanceStatus, Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import { canAll, ForbiddenError, requireClassAccess, requireStudentAccess } from "@/server/rbac/policies";
import { addDays, dayStart, formatTime, isoDay } from "@/lib/time";
import { actor, paginate, type ServiceContext } from "./context";
import { notifyGuardians } from "./notify";
import { found, getActiveYear } from "./structure";
import { storeDocument } from "./students";

export interface RollCallEntry {
  studentId: string;
  status: AttendanceStatus;
  minutesLate?: number | null;
  /** Identifiant généré par le téléphone : rend la synchronisation hors ligne idempotente. */
  clientId?: string | null;
}

/** Créneaux du jour du professeur connecté (pour faire l'appel en un clic). */
export async function myTodaySlots(ctx: ServiceContext, date: Date = dayStart()) {
  if (!ctx.staffId) return [];
  const year = await getActiveYear(ctx);
  return ctx.db.timetableSlot.findMany({
    where: { staffId: ctx.staffId, dayOfWeek: isoDay(date), class: { academicYearId: year?.id ?? "" } },
    include: { class: true, subject: true, exceptions: { where: { date } } },
    orderBy: { startMin: "asc" },
  });
}

/** Feuille d'appel : élèves de la classe et statut déjà saisi pour ce cours. */
export async function getRollCall(ctx: ServiceContext, input: { classId: string; date: Date; slotId?: string | null }) {
  requireClassAccess(ctx.scope, "attendance.write", input.classId);
  const cls = await found(ctx.db.class.findUnique({ where: { id: input.classId } }));
  const slot = input.slotId
    ? await found(ctx.db.timetableSlot.findUnique({ where: { id: input.slotId }, include: { subject: true } }))
    : null;
  if (slot && slot.classId !== cls.id) throw new DomainError("invalid", "slotId");
  const [enrollments, records] = await Promise.all([
    ctx.db.enrollment.findMany({
      where: { classId: cls.id, status: "ACTIVE", deletedAt: null },
      include: { student: true },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    }),
    ctx.db.attendance.findMany({ where: { classId: cls.id, date: input.date, timetableSlotId: slot?.id ?? null } }),
  ]);
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  return {
    class: cls,
    slot,
    alreadyTaken: records.length > 0,
    students: enrollments.map((e) => ({
      id: e.student.id,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      status: byStudent.get(e.studentId)?.status ?? null,
      minutesLate: byStudent.get(e.studentId)?.minutesLate ?? null,
    })),
  };
}

/**
 * Enregistre l'appel. Une saisie existante est mise à jour ; un même envoi
 * rejoué (synchronisation hors ligne) ne crée pas de doublon. Les parents
 * d'un élève nouvellement absent sont prévenus immédiatement (WhatsApp + in-app).
 */
export async function saveRollCall(
  ctx: ServiceContext,
  input: { classId: string; date: Date; slotId?: string | null; entries: RollCallEntry[] },
) {
  requireClassAccess(ctx.scope, "attendance.write", input.classId);
  if (input.date > dayStart()) throw new DomainError("futureDate", "date");
  if (input.date < addDays(dayStart(), -30) && !canAll(ctx.scope, "attendance.write"))
    throw new DomainError("tooOld", "date");
  const slot = input.slotId
    ? await found(ctx.db.timetableSlot.findUnique({ where: { id: input.slotId }, include: { subject: true } }))
    : null;
  if (slot && slot.classId !== input.classId) throw new DomainError("invalid", "slotId");

  const enrolled = new Set(
    (
      await ctx.db.enrollment.findMany({
        where: { classId: input.classId, status: "ACTIVE", deletedAt: null },
        select: { studentId: true },
      })
    ).map((e) => e.studentId),
  );
  if (input.entries.some((e) => !enrolled.has(e.studentId))) throw new ForbiddenError();

  const newlyAbsent: string[] = [];
  for (const entry of input.entries) {
    if (entry.clientId) {
      const replay = await ctx.db.attendance.findFirst({ where: { clientId: entry.clientId } });
      if (replay) continue;
    }
    const existing = await ctx.db.attendance.findFirst({
      where: { studentId: entry.studentId, date: input.date, timetableSlotId: slot?.id ?? null },
    });
    const data = {
      status: entry.status,
      minutesLate: entry.status === "LATE" ? (entry.minutesLate ?? null) : null,
      recordedById: ctx.user.id,
    };
    if (existing) {
      if (existing.status !== entry.status || existing.minutesLate !== data.minutesLate) {
        await ctx.db.attendance.update({ where: { id: existing.id }, data });
      }
      if (entry.status === "ABSENT" && !existing.parentNotifiedAt) newlyAbsent.push(existing.id);
    } else {
      const created = await ctx.db.attendance.create({
        data: {
          schoolId: ctx.school.id,
          clientId: entry.clientId ?? null,
          studentId: entry.studentId,
          classId: input.classId,
          subjectId: slot?.subjectId ?? null,
          timetableSlotId: slot?.id ?? null,
          date: input.date,
          ...data,
        },
      });
      if (entry.status === "ABSENT") newlyAbsent.push(created.id);
    }
  }

  for (const id of newlyAbsent) await notifyAbsence(ctx, id);
  return { saved: input.entries.length, notified: newlyAbsent.length };
}

async function notifyAbsence(ctx: ServiceContext, attendanceId: string) {
  const record = await ctx.db.attendance.findUniqueOrThrow({
    where: { id: attendanceId },
    include: { student: true, subject: true, timetableSlot: true },
  });
  const day = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(record.date);
  const course = record.subject
    ? ` au cours de ${record.subject.name}${record.timetableSlot ? ` (${formatTime(record.timetableSlot.startMin)})` : ""}`
    : "";
  await notifyGuardians(ctx, record.studentId, {
    type: "attendance.absent",
    title: `Absence — ${record.student.firstName} ${record.student.lastName}`,
    body: `${record.student.firstName} est absent(e)${course} ce ${day}. Merci de justifier l'absence dans LAKOL ou auprès de l'école.`,
    link: `/${ctx.school.slug}/attendance`,
  });
  await ctx.db.attendance.update({ where: { id: attendanceId }, data: { parentNotifiedAt: new Date() } });
}

// ── Suivi et justificatifs ─────────────────────────────────────────────────

/** Absences et retards : toute l'école (vie scolaire) ou le périmètre (enfants, élève, classes du prof). */
export async function listAbsences(
  ctx: ServiceContext,
  filters: { classId?: string; from?: Date; to?: Date; pendingOnly?: boolean; page?: number },
) {
  const { skip, take, page } = paginate(filters.page);
  const all = canAll(ctx.scope, "attendance.read");
  const where: Prisma.AttendanceWhereInput = {
    status: { in: ["ABSENT", "LATE"] },
    ...(all
      ? {}
      : ctx.scope.classIds.size > 0
        ? { classId: { in: [...ctx.scope.classIds] } }
        : { studentId: { in: [...ctx.scope.studentIds] } }),
    ...(filters.classId ? { classId: filters.classId } : {}),
    ...(filters.from || filters.to ? { date: { gte: filters.from, lte: filters.to } } : {}),
    ...(filters.pendingOnly ? { justified: false, justificationSubmittedAt: { not: null } } : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.attendance.findMany({
      where,
      include: { student: true, class: true, subject: true, timetableSlot: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    ctx.db.attendance.count({ where }),
  ]);
  const docs = await ctx.db.document.findMany({
    where: { entityType: "Attendance", entityId: { in: items.map((i) => i.id) }, deletedAt: null },
  });
  return { items: items.map((i) => ({ ...i, documents: docs.filter((d) => d.entityId === i.id) })), total, page };
}

/** Le parent justifie une absence (motif + pièce facultative). */
export async function submitJustification(
  ctx: ServiceContext,
  input: { attendanceId: string; reason: string; file?: File | null },
) {
  const record = await ctx.db.attendance.findUnique({ where: { id: input.attendanceId } });
  if (!record) throw new NotFoundError();
  requireStudentAccess(ctx.scope, "attendance.justify", record.studentId);
  if (record.justified) throw new DomainError("alreadyJustified");
  await ctx.db.attendance.update({
    where: { id: record.id },
    data: { reason: input.reason, justificationSubmittedAt: new Date() },
  });
  if (input.file) {
    await storeDocument(ctx, {
      entityType: "Attendance",
      entityId: record.id,
      category: "JUSTIFICATION",
      file: input.file,
    });
  }
}

/** La vie scolaire accepte ou refuse un justificatif (ou justifie directement). */
export async function reviewJustification(
  ctx: ServiceContext,
  input: { attendanceId: string; accept: boolean; reason?: string | null },
) {
  if (!canAll(ctx.scope, "attendance.write")) throw new ForbiddenError();
  const record = await found(ctx.db.attendance.findUnique({ where: { id: input.attendanceId } }));
  await ctx.db.attendance.update({
    where: { id: record.id },
    data: {
      justified: input.accept,
      justifiedById: ctx.user.id,
      reason: input.reason ?? record.reason,
      status: input.accept && record.status === "ABSENT" ? "EXCUSED" : record.status,
    },
  });
  await audit(ctx.db, actor(ctx), {
    action: input.accept ? "attendance.justify" : "attendance.reject",
    entityType: "Attendance",
    entityId: record.id,
    before: { status: record.status, justified: record.justified },
    after: { justified: input.accept },
  });
}

/** Assiduité : nombre de demi-journées / cours par statut sur une période. */
export async function attendanceStats(
  ctx: ServiceContext,
  filter: { classId?: string; studentId?: string; from: Date; to: Date },
) {
  if (filter.classId) requireClassAccess(ctx.scope, "attendance.read", filter.classId);
  if (filter.studentId) requireStudentAccess(ctx.scope, "attendance.read", filter.studentId);
  const groups = await ctx.db.attendance.groupBy({
    by: ["status"],
    where: {
      ...(filter.classId ? { classId: filter.classId } : {}),
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      date: { gte: filter.from, lte: filter.to },
    },
    _count: { _all: true },
  });
  const count = (s: AttendanceStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const total = groups.reduce((t, g) => t + g._count._all, 0);
  const present = count("PRESENT") + count("LATE");
  return {
    total,
    present: count("PRESENT"),
    late: count("LATE"),
    absent: count("ABSENT"),
    excused: count("EXCUSED"),
    rate: total ? Math.round((present / total) * 1000) / 10 : null,
  };
}
