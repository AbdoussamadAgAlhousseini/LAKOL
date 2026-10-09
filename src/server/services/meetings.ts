import "server-only";
import { DomainError } from "@/server/errors";
import { ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import { addDays } from "@/lib/time";
import type { ServiceContext } from "./context";
import { notifyUser } from "./notify";
import { found, getActiveYear } from "./structure";

const fmtDate = (d: Date, tz: string) =>
  `${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(d)} à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d)}`;

function requireTeacher(ctx: ServiceContext) {
  if (!ctx.scope.permissions.has("meeting.manage:own") || !ctx.staffId) throw new ForbiddenError();
  return ctx.staffId;
}

/** Le professeur publie une série de créneaux (ex. 6 créneaux de 15 min à partir de 16 h). */
export async function createSlots(
  ctx: ServiceContext,
  input: { date: Date; startMin: number; count: number; durationMin: number; location?: string | null },
) {
  const staffId = requireTeacher(ctx);
  if (input.count < 1 || input.count > 20 || input.durationMin < 5 || input.durationMin > 120)
    throw new DomainError("invalid", "count");
  const first = new Date(input.date.getTime() + input.startMin * 60_000);
  if (first < new Date()) throw new DomainError("dateInPast", "date");
  const slots = Array.from({ length: input.count }, (_, i) => {
    const startsAt = new Date(first.getTime() + i * input.durationMin * 60_000);
    return {
      schoolId: ctx.school.id,
      staffId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + input.durationMin * 60_000),
      location: input.location ?? null,
    };
  });
  const overlapping = await ctx.db.meetingSlot.count({
    where: {
      staffId,
      status: { not: "CANCELLED" },
      startsAt: { lt: slots.at(-1)!.endsAt },
      endsAt: { gt: slots[0].startsAt },
    },
  });
  if (overlapping > 0) throw new DomainError("slotOverlap", "startMin");
  await ctx.db.meetingSlot.createMany({ data: slots });
  return { created: slots.length };
}

/** Créneaux à venir du professeur (libres et réservés). */
export async function listMySlots(ctx: ServiceContext) {
  const staffId = requireTeacher(ctx);
  const slots = await ctx.db.meetingSlot.findMany({
    where: { staffId, status: { not: "CANCELLED" }, endsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
  });
  const guardians = await ctx.db.guardian.findMany({
    where: { id: { in: slots.map((s) => s.guardianId).filter((x): x is string => Boolean(x)) } },
  });
  const students = await ctx.db.student.findMany({
    where: { id: { in: slots.map((s) => s.studentId).filter((x): x is string => Boolean(x)) } },
  });
  return slots.map((s) => ({
    ...s,
    guardian: guardians.find((g) => g.id === s.guardianId) ?? null,
    student: students.find((x) => x.id === s.studentId) ?? null,
  }));
}

/** Le professeur retire un créneau ; s'il était réservé, le parent est prévenu. */
export async function cancelSlot(ctx: ServiceContext, slotId: string) {
  const staffId = requireTeacher(ctx);
  const slot = await found(ctx.db.meetingSlot.findFirst({ where: { id: slotId, staffId } }));
  await ctx.db.meetingSlot.update({ where: { id: slot.id }, data: { status: "CANCELLED" } });
  if (slot.status === "BOOKED" && slot.guardianId) {
    const guardian = await ctx.db.guardian.findUnique({ where: { id: slot.guardianId }, include: { user: true } });
    if (guardian?.user) {
      await notifyUser(ctx, guardian.user, {
        type: "meeting.cancelled",
        title: "Rendez-vous annulé",
        body: `${ctx.user.firstName} ${ctx.user.lastName} a annulé le rendez-vous du ${fmtDate(slot.startsAt, ctx.school.timezone)}. Vous pouvez choisir un autre créneau.`,
        link: `/${ctx.school.slug}/meetings`,
      });
    }
  }
}

/** Professeurs (et leurs créneaux libres) des classes des enfants du parent, sur 60 jours. */
export async function availableSlots(ctx: ServiceContext) {
  if (!ctx.scope.permissions.has("meeting.book:own")) throw new ForbiddenError();
  const year = await getActiveYear(ctx);
  const enrollments = await ctx.db.enrollment.findMany({
    where: {
      studentId: { in: [...ctx.scope.studentIds] },
      academicYearId: year?.id ?? "",
      status: "ACTIVE",
      deletedAt: null,
    },
    include: {
      student: true,
      class: { include: { teachingAssignments: { include: { staff: true, subject: true } } } },
    },
  });
  const teachers = new Map<
    string,
    { staffId: string; name: string; subjects: Set<string>; students: Map<string, string> }
  >();
  for (const e of enrollments) {
    for (const a of e.class.teachingAssignments) {
      const t = teachers.get(a.staffId) ?? {
        staffId: a.staffId,
        name: `${a.staff.firstName} ${a.staff.lastName}`,
        subjects: new Set(),
        students: new Map(),
      };
      t.subjects.add(a.subject.name);
      t.students.set(e.studentId, e.student.firstName);
      teachers.set(a.staffId, t);
    }
    if (e.class.headTeacherId) {
      const t = teachers.get(e.class.headTeacherId);
      t?.students.set(e.studentId, e.student.firstName);
    }
  }
  const slots = await ctx.db.meetingSlot.findMany({
    where: {
      staffId: { in: [...teachers.keys()] },
      status: "OPEN",
      startsAt: { gte: new Date(), lte: addDays(new Date(), 60) },
    },
    orderBy: { startsAt: "asc" },
  });
  return [...teachers.values()]
    .map((t) => ({
      ...t,
      subjects: [...t.subjects],
      students: [...t.students.entries()].map(([id, name]) => ({ id, name })),
      slots: slots.filter((s) => s.staffId === t.staffId),
    }))
    .sort((a, b) => b.slots.length - a.slots.length || a.name.localeCompare(b.name));
}

async function myGuardian(ctx: ServiceContext) {
  const guardian = await ctx.db.guardian.findFirst({ where: { userId: ctx.user.id, deletedAt: null } });
  if (!guardian) throw new ForbiddenError();
  return guardian;
}

/** Le parent réserve un créneau d'un professeur de son enfant ; le professeur est prévenu. */
export async function bookSlot(
  ctx: ServiceContext,
  input: { slotId: string; studentId: string; note?: string | null },
) {
  if (!ctx.scope.permissions.has("meeting.book:own")) throw new ForbiddenError();
  requireStudentAccess(ctx.scope, "student.read", input.studentId);
  const guardian = await myGuardian(ctx);
  const slot = await found(ctx.db.meetingSlot.findFirst({ where: { id: input.slotId } }));
  const year = await getActiveYear(ctx);
  const teaches = await ctx.db.class.findFirst({
    where: {
      academicYearId: year?.id ?? "",
      enrollments: { some: { studentId: input.studentId, status: "ACTIVE" } },
      OR: [{ teachingAssignments: { some: { staffId: slot.staffId } } }, { headTeacherId: slot.staffId }],
    },
  });
  if (!teaches) throw new ForbiddenError();
  if (slot.startsAt < new Date()) throw new DomainError("dateInPast");
  // Réservation atomique : échoue si quelqu'un a réservé entre-temps.
  const res = await ctx.db.meetingSlot.updateMany({
    where: { id: slot.id, status: "OPEN" },
    data: {
      status: "BOOKED",
      guardianId: guardian.id,
      studentId: input.studentId,
      note: input.note ?? null,
      bookedAt: new Date(),
    },
  });
  if (res.count === 0) throw new DomainError("slotTaken");
  const staff = await ctx.db.staff.findUnique({ where: { id: slot.staffId }, include: { user: true } });
  const student = await ctx.db.student.findUnique({ where: { id: input.studentId } });
  if (staff?.user) {
    await notifyUser(ctx, staff.user, {
      type: "meeting.booked",
      title: "Nouveau rendez-vous",
      body: `${guardian.firstName} ${guardian.lastName} (parent de ${student?.firstName}) a réservé le créneau du ${fmtDate(slot.startsAt, ctx.school.timezone)}.${input.note ? ` « ${input.note} »` : ""}`,
      link: `/${ctx.school.slug}/meetings`,
    });
  }
}

/** Le parent annule sa réservation ; le créneau redevient libre et le professeur est prévenu. */
export async function cancelBooking(ctx: ServiceContext, slotId: string) {
  const guardian = await myGuardian(ctx);
  const slot = await found(
    ctx.db.meetingSlot.findFirst({ where: { id: slotId, guardianId: guardian.id, status: "BOOKED" } }),
  );
  await ctx.db.meetingSlot.update({
    where: { id: slot.id },
    data: { status: "OPEN", guardianId: null, studentId: null, note: null, bookedAt: null },
  });
  const staff = await ctx.db.staff.findUnique({ where: { id: slot.staffId }, include: { user: true } });
  if (staff?.user) {
    await notifyUser(ctx, staff.user, {
      type: "meeting.cancelled",
      title: "Rendez-vous annulé par le parent",
      body: `${guardian.firstName} ${guardian.lastName} a annulé le rendez-vous du ${fmtDate(slot.startsAt, ctx.school.timezone)}. Le créneau est de nouveau libre.`,
      link: `/${ctx.school.slug}/meetings`,
    });
  }
}

export async function myBookings(ctx: ServiceContext) {
  const guardian = await ctx.db.guardian.findFirst({ where: { userId: ctx.user.id, deletedAt: null } });
  if (!guardian) return [];
  const slots = await ctx.db.meetingSlot.findMany({
    where: { guardianId: guardian.id, status: "BOOKED", endsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
  });
  const staff = await ctx.db.staff.findMany({ where: { id: { in: slots.map((s) => s.staffId) } } });
  const students = await ctx.db.student.findMany({
    where: { id: { in: slots.map((s) => s.studentId!).filter(Boolean) } },
  });
  return slots.map((s) => ({
    ...s,
    staff: staff.find((x) => x.id === s.staffId)!,
    student: students.find((x) => x.id === s.studentId) ?? null,
  }));
}
