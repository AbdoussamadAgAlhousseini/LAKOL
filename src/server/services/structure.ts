import "server-only";
import { audit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import { actor, type ServiceContext } from "./context";
import { grantRole, revokeRole } from "./accounts";

/** Charge une entité de l'école ou lève NotFoundError (protège aussi des id d'autres écoles). */
export async function found<T>(promise: Promise<T | null>): Promise<T> {
  const value = await promise;
  if (!value) throw new NotFoundError();
  return value;
}

export async function getActiveYear(ctx: ServiceContext) {
  return ctx.db.academicYear.findFirst({ where: { isActive: true } });
}

export async function requireActiveYear(ctx: ServiceContext) {
  const year = await getActiveYear(ctx);
  if (!year) throw new DomainError("noActiveYear");
  return year;
}

// ── Années et périodes ─────────────────────────────────────────────────────

const TERM_NAMES = {
  TRIMESTER: ["1er trimestre", "2e trimestre", "3e trimestre"],
  SEMESTER: ["1er semestre", "2e semestre"],
};

/** Découpe l'année en périodes de durées égales (modifiables ensuite). */
export function splitPeriods(start: Date, end: Date, count: number) {
  const span = end.getTime() - start.getTime();
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(start.getTime() + Math.round((span * i) / count));
    const to = i === count - 1 ? end : new Date(start.getTime() + Math.round((span * (i + 1)) / count) - 86_400_000);
    from.setUTCHours(0, 0, 0, 0);
    to.setUTCHours(0, 0, 0, 0);
    return { from, to };
  });
}

export async function createYear(ctx: ServiceContext, input: { name: string; startDate: Date; endDate: Date }) {
  if (input.endDate <= input.startDate) throw new DomainError("endBeforeStart", "endDate");
  if (await ctx.db.academicYear.findFirst({ where: { name: input.name } }))
    throw new DomainError("duplicateName", "name");
  const names = TERM_NAMES[ctx.school.termKind];
  const periods = splitPeriods(input.startDate, input.endDate, names.length);
  return ctx.db.$transaction(async (tx) => {
    const year = await tx.academicYear.create({ data: { schoolId: ctx.school.id, ...input } });
    await tx.term.createMany({
      data: periods.map((p, i) => ({
        schoolId: ctx.school.id,
        academicYearId: year.id,
        name: names[i],
        order: i + 1,
        startDate: p.from,
        endDate: p.to,
      })),
    });
    return year;
  });
}

/** Une seule année active : les autres sont désactivées. */
export async function activateYear(ctx: ServiceContext, yearId: string) {
  const year = await found(ctx.db.academicYear.findUnique({ where: { id: yearId } }));
  if (year.isArchived) throw new DomainError("yearArchived");
  const previous = await getActiveYear(ctx);
  await ctx.db.$transaction([
    ctx.db.academicYear.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    ctx.db.academicYear.update({ where: { id: year.id }, data: { isActive: true } }),
  ]);
  await audit(ctx.db, actor(ctx), {
    action: "year.activate",
    entityType: "AcademicYear",
    entityId: year.id,
    before: { activeYear: previous?.name ?? null },
    after: { activeYear: year.name },
  });
}

export async function archiveYear(ctx: ServiceContext, yearId: string) {
  const year = await found(ctx.db.academicYear.findUnique({ where: { id: yearId } }));
  if (year.isActive) throw new DomainError("cannotArchiveActive");
  await ctx.db.academicYear.update({ where: { id: year.id }, data: { isArchived: true } });
  await audit(ctx.db, actor(ctx), { action: "year.archive", entityType: "AcademicYear", entityId: year.id });
}

export async function updateTerm(
  ctx: ServiceContext,
  input: { id: string; name: string; startDate: Date; endDate: Date },
) {
  const term = await found(ctx.db.term.findUnique({ where: { id: input.id } }));
  if (input.endDate <= input.startDate) throw new DomainError("endBeforeStart", "endDate");
  await ctx.db.term.update({
    where: { id: term.id },
    data: { name: input.name, startDate: input.startDate, endDate: input.endDate },
  });
}

// ── Cycles, niveaux, séries ────────────────────────────────────────────────

export async function createCycle(ctx: ServiceContext, input: { name: string; order: number }) {
  return ctx.db.cycle.create({ data: { schoolId: ctx.school.id, ...input } });
}

interface LevelInput {
  name: string;
  cycleId: string;
  order: number;
  nationalExam?: string | null;
  studentAccounts: boolean;
}

export async function saveLevel(ctx: ServiceContext, input: LevelInput & { id?: string }) {
  await found(ctx.db.cycle.findUnique({ where: { id: input.cycleId } }));
  const data = {
    name: input.name,
    cycleId: input.cycleId,
    order: input.order,
    nationalExam: input.nationalExam ?? null,
    studentAccounts: input.studentAccounts,
  };
  if (input.id) {
    await found(ctx.db.level.findUnique({ where: { id: input.id } }));
    return ctx.db.level.update({ where: { id: input.id }, data });
  }
  return ctx.db.level.create({ data: { schoolId: ctx.school.id, ...data } });
}

export async function deleteLevel(ctx: ServiceContext, id: string) {
  const level = await found(
    ctx.db.level.findUnique({ where: { id }, include: { _count: { select: { classes: true, feeSchedules: true } } } }),
  );
  if (level._count.classes || level._count.feeSchedules) throw new DomainError("inUse");
  await ctx.db.subjectCoefficient.deleteMany({ where: { levelId: id } });
  await ctx.db.level.delete({ where: { id } });
}

export async function createTrack(ctx: ServiceContext, input: { code: string; name: string }) {
  const code = input.code.toUpperCase();
  if (await ctx.db.track.findFirst({ where: { code } })) throw new DomainError("duplicateCode", "code");
  return ctx.db.track.create({ data: { schoolId: ctx.school.id, code, name: input.name } });
}

// ── Salles et matières ─────────────────────────────────────────────────────

export async function saveRoom(ctx: ServiceContext, input: { id?: string; name: string; capacity?: number | null }) {
  const data = { name: input.name, capacity: input.capacity ?? null };
  if (input.id) {
    await found(ctx.db.room.findUnique({ where: { id: input.id } }));
    return ctx.db.room.update({ where: { id: input.id }, data });
  }
  return ctx.db.room.create({ data: { schoolId: ctx.school.id, ...data } });
}

export async function deleteRoom(ctx: ServiceContext, id: string) {
  const room = await found(
    ctx.db.room.findUnique({ where: { id }, include: { _count: { select: { classes: true, timetableSlots: true } } } }),
  );
  if (room._count.classes || room._count.timetableSlots) throw new DomainError("inUse");
  await ctx.db.room.delete({ where: { id } });
}

export async function saveSubject(
  ctx: ServiceContext,
  input: { id?: string; code: string; name: string; color?: string | null },
) {
  const code = input.code.toUpperCase();
  const duplicate = await ctx.db.subject.findFirst({ where: { code, NOT: input.id ? { id: input.id } : undefined } });
  if (duplicate) throw new DomainError("duplicateCode", "code");
  const data = { code, name: input.name, color: input.color ?? null };
  if (input.id) {
    await found(ctx.db.subject.findUnique({ where: { id: input.id } }));
    return ctx.db.subject.update({ where: { id: input.id }, data });
  }
  return ctx.db.subject.create({ data: { schoolId: ctx.school.id, ...data } });
}

export async function deleteSubject(ctx: ServiceContext, id: string) {
  const subject = await found(
    ctx.db.subject.findUnique({
      where: { id },
      include: { _count: { select: { teachingAssignments: true, assessments: true, homeworks: true } } },
    }),
  );
  const c = subject._count;
  if (c.teachingAssignments || c.assessments || c.homeworks) throw new DomainError("inUse");
  await ctx.db.subjectCoefficient.deleteMany({ where: { subjectId: id } });
  await ctx.db.subject.delete({ where: { id } });
}

/** Remplace les coefficients d'un niveau (et d'une série au lycée). Coefficient 0 = matière non enseignée. */
export async function setCoefficients(
  ctx: ServiceContext,
  input: {
    levelId: string;
    trackId?: string | null;
    entries: { subjectId: string; coefficient: number; weeklyMinutes?: number | null }[];
  },
) {
  await found(ctx.db.level.findUnique({ where: { id: input.levelId } }));
  if (input.trackId) await found(ctx.db.track.findUnique({ where: { id: input.trackId } }));
  const subjectIds = input.entries.map((e) => e.subjectId);
  const known = await ctx.db.subject.count({ where: { id: { in: subjectIds } } });
  if (known !== new Set(subjectIds).size) throw new NotFoundError();

  const trackId = input.trackId ?? null;
  await ctx.db.$transaction(async (tx) => {
    await tx.subjectCoefficient.deleteMany({ where: { levelId: input.levelId, trackId } });
    await tx.subjectCoefficient.createMany({
      data: input.entries
        .filter((e) => e.coefficient > 0)
        .map((e) => ({
          schoolId: ctx.school.id,
          levelId: input.levelId,
          trackId,
          subjectId: e.subjectId,
          coefficient: e.coefficient,
          weeklyMinutes: e.weeklyMinutes ?? null,
        })),
    });
  });
}

// ── Classes et affectations ────────────────────────────────────────────────

interface ClassInput {
  id?: string;
  name: string;
  levelId: string;
  trackId?: string | null;
  roomId?: string | null;
  headTeacherId?: string | null;
  capacity?: number | null;
}

export async function saveClass(ctx: ServiceContext, input: ClassInput) {
  const year = await requireActiveYear(ctx);
  await found(ctx.db.level.findUnique({ where: { id: input.levelId } }));
  if (input.trackId) await found(ctx.db.track.findUnique({ where: { id: input.trackId } }));
  if (input.roomId) await found(ctx.db.room.findUnique({ where: { id: input.roomId } }));
  if (input.headTeacherId) await found(ctx.db.staff.findUnique({ where: { id: input.headTeacherId } }));

  const duplicate = await ctx.db.class.findFirst({
    where: { academicYearId: year.id, name: input.name, NOT: input.id ? { id: input.id } : undefined },
  });
  if (duplicate) throw new DomainError("duplicateName", "name");

  const data = {
    name: input.name,
    levelId: input.levelId,
    trackId: input.trackId ?? null,
    roomId: input.roomId ?? null,
    headTeacherId: input.headTeacherId ?? null,
    capacity: input.capacity ?? null,
  };
  let previousHead: string | null = null;
  let cls;
  if (input.id) {
    const existing = await found(ctx.db.class.findUnique({ where: { id: input.id } }));
    previousHead = existing.headTeacherId;
    cls = await ctx.db.class.update({ where: { id: existing.id }, data });
  } else {
    cls = await ctx.db.class.create({ data: { schoolId: ctx.school.id, academicYearId: year.id, ...data } });
  }
  if (previousHead !== data.headTeacherId) {
    await syncHeadTeacherRole(ctx, previousHead);
    await syncHeadTeacherRole(ctx, data.headTeacherId);
  }
  return cls;
}

/** Le rôle « professeur principal » suit l'attribution des classes de l'année active. */
export async function syncHeadTeacherRole(ctx: ServiceContext, staffId: string | null) {
  if (!staffId) return;
  const staff = await ctx.db.staff.findUnique({ where: { id: staffId } });
  if (!staff?.userId) return;
  const year = await getActiveYear(ctx);
  const headed = year ? await ctx.db.class.count({ where: { headTeacherId: staffId, academicYearId: year.id } }) : 0;
  if (headed > 0) await grantRole(ctx, staff.userId, "HEAD_TEACHER");
  else await revokeRole(ctx, staff.userId, "HEAD_TEACHER");
}

export async function deleteClass(ctx: ServiceContext, id: string) {
  const cls = await found(
    ctx.db.class.findUnique({
      where: { id },
      include: { _count: { select: { enrollments: true, assessments: true, homeworks: true, attendances: true } } },
    }),
  );
  const c = cls._count;
  if (c.enrollments || c.assessments || c.homeworks || c.attendances) throw new DomainError("inUse");
  await ctx.db.teachingAssignment.deleteMany({ where: { classId: id } });
  await ctx.db.timetableSlot.deleteMany({ where: { classId: id } });
  await ctx.db.class.delete({ where: { id } });
  await syncHeadTeacherRole(ctx, cls.headTeacherId);
}

export async function addAssignment(
  ctx: ServiceContext,
  input: { classId: string; subjectId: string; staffId: string },
) {
  const cls = await found(ctx.db.class.findUnique({ where: { id: input.classId } }));
  await found(ctx.db.subject.findUnique({ where: { id: input.subjectId } }));
  const staff = await found(ctx.db.staff.findUnique({ where: { id: input.staffId } }));
  if (!staff.isActive) throw new DomainError("staffInactive");
  const existing = await ctx.db.teachingAssignment.findFirst({
    where: { classId: cls.id, subjectId: input.subjectId },
  });
  if (existing) throw new DomainError("subjectAlreadyAssigned", "subjectId");
  if (staff.userId) await grantRole(ctx, staff.userId, "TEACHER");
  return ctx.db.teachingAssignment.create({
    data: {
      schoolId: ctx.school.id,
      classId: cls.id,
      subjectId: input.subjectId,
      staffId: staff.id,
      academicYearId: cls.academicYearId,
    },
  });
}

export async function removeAssignment(ctx: ServiceContext, id: string) {
  const assignment = await found(ctx.db.teachingAssignment.findUnique({ where: { id } }));
  await ctx.db.teachingAssignment.delete({ where: { id: assignment.id } });
}
