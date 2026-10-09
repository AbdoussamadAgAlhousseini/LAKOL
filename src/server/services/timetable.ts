import "server-only";
import type { TimetableExceptionKind } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { addDays, formatTime, isoDay, overlaps, weekStart } from "@/lib/time";
import { actor, type ServiceContext } from "./context";
import { notifyGuardians } from "./notify";
import { found, requireActiveYear } from "./structure";

const DAY_START = 6 * 60;
const DAY_END = 20 * 60;

export interface SlotInput {
  classId: string;
  subjectId: string;
  roomId?: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
}

/**
 * Conflits d'un créneau avec l'emploi du temps existant de l'année active :
 * même classe, même professeur ou même salle sur une plage qui se chevauche.
 */
export async function findConflicts(ctx: ServiceContext, slot: SlotInput & { staffId: string }, ignoreId?: string) {
  const year = await requireActiveYear(ctx);
  const sameDay = await ctx.db.timetableSlot.findMany({
    where: {
      dayOfWeek: slot.dayOfWeek,
      class: { academicYearId: year.id },
      NOT: ignoreId ? { id: ignoreId } : undefined,
      OR: [{ classId: slot.classId }, { staffId: slot.staffId }, ...(slot.roomId ? [{ roomId: slot.roomId }] : [])],
    },
    include: { class: true, subject: true },
  });
  const clashes = sameDay.filter((s) => overlaps(s, slot));
  return {
    class: clashes.find((s) => s.classId === slot.classId) ?? null,
    teacher: clashes.find((s) => s.staffId === slot.staffId) ?? null,
    room: slot.roomId ? (clashes.find((s) => s.roomId === slot.roomId) ?? null) : null,
  };
}

/** Ajoute un créneau ; le professeur est celui affecté à la matière dans la classe. */
export async function addSlot(ctx: ServiceContext, input: SlotInput) {
  if (input.dayOfWeek < 1 || input.dayOfWeek > 7) throw new DomainError("invalid", "dayOfWeek");
  if (input.endMin <= input.startMin) throw new DomainError("endBeforeStart", "endMin");
  if (input.startMin < DAY_START || input.endMin > DAY_END) throw new DomainError("outsideSchoolHours", "startMin");
  await found(ctx.db.class.findUnique({ where: { id: input.classId } }));
  if (input.roomId) await found(ctx.db.room.findUnique({ where: { id: input.roomId } }));
  const assignment = await ctx.db.teachingAssignment.findFirst({
    where: { classId: input.classId, subjectId: input.subjectId },
  });
  if (!assignment) throw new DomainError("subjectNotAssigned", "subjectId");

  const slot = { ...input, roomId: input.roomId ?? null, staffId: assignment.staffId };
  const conflicts = await findConflicts(ctx, slot);
  if (conflicts.class) throw new DomainError("conflictClass", "startMin");
  if (conflicts.teacher) throw new DomainError("conflictTeacher", "startMin");
  if (conflicts.room) throw new DomainError("conflictRoom", "roomId");

  return ctx.db.timetableSlot.create({ data: { schoolId: ctx.school.id, ...slot } });
}

export async function deleteSlot(ctx: ServiceContext, id: string) {
  const slot = await found(ctx.db.timetableSlot.findUnique({ where: { id } }));
  await ctx.db.timetableSlot.delete({ where: { id: slot.id } });
}

/** Créneaux d'une classe ou d'un professeur pour l'année active, avec les exceptions de la semaine. */
export async function getWeek(
  ctx: ServiceContext,
  filter: { classId?: string; staffId?: string },
  week: Date = new Date(),
) {
  const year = await requireActiveYear(ctx);
  const monday = weekStart(week);
  const slots = await ctx.db.timetableSlot.findMany({
    where: { ...filter, class: { academicYearId: year.id } },
    include: {
      class: true,
      subject: true,
      staff: true,
      room: true,
      exceptions: { where: { date: { gte: monday, lt: addDays(monday, 7) } } },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
  });
  return { monday, slots };
}

/** Annule ou remplace un cours à une date ; les parents de la classe sont prévenus. */
export async function setException(
  ctx: ServiceContext,
  input: {
    slotId: string;
    date: Date;
    kind: TimetableExceptionKind;
    replacementStaffId?: string | null;
    note?: string | null;
  },
) {
  const slot = await found(
    ctx.db.timetableSlot.findUnique({ where: { id: input.slotId }, include: { subject: true, class: true } }),
  );
  if (isoDay(input.date) !== slot.dayOfWeek) throw new DomainError("dateNotOnSlotDay", "date");
  let replacement = null;
  if (input.kind === "REPLACED") {
    if (!input.replacementStaffId) throw new DomainError("replacementRequired", "replacementStaffId");
    replacement = await found(ctx.db.staff.findUnique({ where: { id: input.replacementStaffId } }));
  }
  const data = {
    kind: input.kind,
    replacementStaffId: replacement?.id ?? null,
    note: input.note ?? null,
    createdById: ctx.user.id,
  };
  const exception = await ctx.db.timetableException.upsert({
    where: { slotId_date: { slotId: slot.id, date: input.date } },
    create: { schoolId: ctx.school.id, slotId: slot.id, date: input.date, ...data },
    update: data,
  });

  const when = `${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(input.date)} à ${formatTime(slot.startMin)}`;
  const message =
    input.kind === "CANCELLED"
      ? {
          type: "timetable.cancelled",
          title: `Cours annulé — ${slot.class.name}`,
          body: `${slot.subject.name} du ${when} est annulé.${input.note ? ` ${input.note}` : ""}`,
        }
      : {
          type: "timetable.replaced",
          title: `Professeur remplaçant — ${slot.class.name}`,
          body: `${slot.subject.name} du ${when} sera assuré par ${replacement!.firstName} ${replacement!.lastName}.${input.note ? ` ${input.note}` : ""}`,
        };
  const enrolled = await ctx.db.enrollment.findMany({
    where: { classId: slot.classId, status: "ACTIVE", deletedAt: null },
    select: { studentId: true },
  });
  for (const { studentId } of enrolled) {
    await notifyGuardians(ctx, studentId, { ...message, link: `/${ctx.school.slug}/timetable` });
  }
  await audit(ctx.db, actor(ctx), {
    action: `timetable.${input.kind.toLowerCase()}`,
    entityType: "TimetableSlot",
    entityId: slot.id,
    after: { date: input.date.toISOString().slice(0, 10), ...data },
  });
  return exception;
}

export async function removeException(ctx: ServiceContext, id: string) {
  const exception = await found(ctx.db.timetableException.findUnique({ where: { id } }));
  await ctx.db.timetableException.delete({ where: { id: exception.id } });
}
