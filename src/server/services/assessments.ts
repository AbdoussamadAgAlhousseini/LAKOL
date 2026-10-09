import "server-only";
import type { AssessmentType } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { canAll, canOnClass, ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import { generalAverage, parseScoreInput, ranks, stats, subjectAverage, suggestDistinction } from "@/lib/grading";
import { actor, type ServiceContext } from "./context";
import { found, getActiveYear } from "./structure";
import { readSpreadsheet } from "./import";

/** Le professeur connecté enseigne cette matière dans cette classe. */
async function teaches(ctx: ServiceContext, classId: string, subjectId: string) {
  if (!ctx.staffId) return false;
  return Boolean(await ctx.db.teachingAssignment.findFirst({ where: { classId, subjectId, staffId: ctx.staffId } }));
}

async function requireGradeWriter(ctx: ServiceContext, classId: string, subjectId: string) {
  if (!ctx.scope.permissions.has("grade.write:own") || !(await teaches(ctx, classId, subjectId)))
    throw new ForbiddenError();
}

export async function termsOfActiveYear(ctx: ServiceContext) {
  const year = await getActiveYear(ctx);
  return year ? ctx.db.term.findMany({ where: { academicYearId: year.id }, orderBy: { order: "asc" } }) : [];
}

/** Période en cours (ou la dernière commencée). */
export async function currentTerm(ctx: ServiceContext) {
  const terms = await termsOfActiveYear(ctx);
  const now = new Date();
  return (
    terms.find((t) => t.startDate <= now && now <= t.endDate) ??
    [...terms].reverse().find((t) => t.startDate <= now) ??
    terms[0] ??
    null
  );
}

// ── Évaluations ────────────────────────────────────────────────────────────

export interface AssessmentInput {
  classId: string;
  subjectId: string;
  termId: string;
  type: AssessmentType;
  title: string;
  date: Date;
  outOf: number;
  weight: number;
}

export async function createAssessment(ctx: ServiceContext, input: AssessmentInput) {
  await requireGradeWriter(ctx, input.classId, input.subjectId);
  const term = await found(ctx.db.term.findUnique({ where: { id: input.termId } }));
  if (term.isLocked) throw new DomainError("termLocked", "termId");
  if (![10, 20].includes(input.outOf)) throw new DomainError("invalid", "outOf");
  return ctx.db.assessment.create({ data: { schoolId: ctx.school.id, staffId: ctx.staffId!, ...input } });
}

export async function deleteAssessment(ctx: ServiceContext, id: string) {
  const a = await found(
    ctx.db.assessment.findUnique({ where: { id }, include: { _count: { select: { grades: true } } } }),
  );
  await requireGradeWriter(ctx, a.classId, a.subjectId);
  if (a.isLocked) throw new DomainError("assessmentLocked");
  await ctx.db.grade.deleteMany({ where: { assessmentId: id } });
  await ctx.db.assessment.delete({ where: { id } });
}

/** Évaluations visibles : celles des matières du professeur, ou toutes (direction). */
export async function listAssessments(ctx: ServiceContext, filters: { classId?: string; termId?: string }) {
  const all = canAll(ctx.scope, "grade.read");
  const assignments =
    !all && ctx.staffId ? await ctx.db.teachingAssignment.findMany({ where: { staffId: ctx.staffId } }) : [];
  if (!all && assignments.length === 0) return [];
  return ctx.db.assessment.findMany({
    where: {
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.termId ? { termId: filters.termId } : {}),
      ...(all ? {} : { OR: assignments.map((a) => ({ classId: a.classId, subjectId: a.subjectId })) }),
    },
    include: {
      class: true,
      subject: true,
      term: true,
      _count: { select: { grades: { where: { OR: [{ score: { not: null } }, { isAbsent: true }] } } } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
}

// ── Saisie des notes ───────────────────────────────────────────────────────

/** Grille de saisie : élèves de la classe et note éventuelle. */
export async function getGradeSheet(ctx: ServiceContext, assessmentId: string) {
  const a = await found(
    ctx.db.assessment.findUnique({ where: { id: assessmentId }, include: { class: true, subject: true, term: true } }),
  );
  const writer = await teaches(ctx, a.classId, a.subjectId);
  if (!writer && !canAll(ctx.scope, "grade.read")) throw new ForbiddenError();
  const [enrollments, grades] = await Promise.all([
    ctx.db.enrollment.findMany({
      where: { classId: a.classId, status: "ACTIVE", deletedAt: null },
      include: { student: true },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    }),
    ctx.db.grade.findMany({ where: { assessmentId, deletedAt: null } }),
  ]);
  const byStudent = new Map(grades.map((g) => [g.studentId, g]));
  return {
    assessment: a,
    canEdit: writer && (!a.isLocked || canAll(ctx.scope, "grade.unlock")),
    rows: enrollments.map((e) => ({ student: e.student, grade: byStudent.get(e.studentId) ?? null })),
  };
}

/**
 * Enregistre les notes saisies (« 13,5 », « abs », vide). Une note modifiée
 * après validation exige le droit de déverrouillage et est tracée.
 */
export async function saveGrades(
  ctx: ServiceContext,
  input: { assessmentId: string; entries: { studentId: string; value: string; comment?: string | null }[] },
) {
  const a = await found(ctx.db.assessment.findUnique({ where: { id: input.assessmentId } }));
  const writer = await teaches(ctx, a.classId, a.subjectId);
  const canUnlock = canAll(ctx.scope, "grade.unlock");
  if (!writer && !canUnlock) throw new ForbiddenError();
  if (a.isLocked && !canUnlock) throw new DomainError("assessmentLocked");

  const enrolled = new Set(
    (
      await ctx.db.enrollment.findMany({
        where: { classId: a.classId, status: "ACTIVE", deletedAt: null },
        select: { studentId: true },
      })
    ).map((e) => e.studentId),
  );
  const invalid: string[] = [];
  const parsed = input.entries.map((e) => {
    if (!enrolled.has(e.studentId)) throw new ForbiddenError();
    const value = parseScoreInput(e.value);
    if (value === "invalid" || (value.score !== null && value.score > a.outOf * 100)) invalid.push(e.studentId);
    return { ...e, value };
  });
  if (invalid.length) throw new DomainError("invalidScores", `grade_${invalid[0]}`);

  let saved = 0;
  for (const e of parsed) {
    const value = e.value as Exclude<typeof e.value, "invalid">;
    const existing = await ctx.db.grade.findFirst({ where: { assessmentId: a.id, studentId: e.studentId } });
    const empty = value.score === null && !value.absent;
    if (empty && !existing) continue;
    const data = {
      score: value.score,
      isAbsent: value.absent,
      comment: e.comment ?? existing?.comment ?? null,
      deletedAt: null,
    };
    if (existing) {
      if (existing.score === data.score && existing.isAbsent === data.isAbsent && existing.comment === data.comment)
        continue;
      await ctx.db.grade.update({ where: { id: existing.id }, data });
      if (a.isLocked) {
        await audit(ctx.db, actor(ctx), {
          action: "grade.update_after_lock",
          entityType: "Grade",
          entityId: existing.id,
          before: { score: existing.score, isAbsent: existing.isAbsent },
          after: { score: data.score, isAbsent: data.isAbsent },
        });
      }
    } else {
      await ctx.db.grade.create({
        data: { schoolId: ctx.school.id, assessmentId: a.id, studentId: e.studentId, ...data },
      });
    }
    saved += 1;
  }
  return { saved };
}

/** Import d'un fichier « matricule ; note » pour une évaluation. */
export async function importGrades(ctx: ServiceContext, input: { assessmentId: string; file: File }) {
  const a = await found(ctx.db.assessment.findUnique({ where: { id: input.assessmentId } }));
  const records = await readSpreadsheet(Buffer.from(await input.file.arrayBuffer()), input.file.name);
  const students = await ctx.db.student.findMany({
    where: { enrollments: { some: { classId: a.classId, status: "ACTIVE", deletedAt: null } } },
    select: { id: true, matricule: true },
  });
  const byMatricule = new Map(students.map((s) => [s.matricule.toLowerCase(), s.id]));
  const unknown: string[] = [];
  const entries = records.flatMap((r) => {
    const id = byMatricule.get((r.matricule ?? "").trim().toLowerCase());
    if (!id) {
      if (r.matricule) unknown.push(r.matricule);
      return [];
    }
    return [{ studentId: id, value: r.note ?? "" }];
  });
  if (unknown.length) throw new DomainError("unknownMatricule", "file");
  return saveGrades(ctx, { assessmentId: a.id, entries });
}

// ── Validation (verrouillage) ──────────────────────────────────────────────

/** La direction valide les notes d'une classe pour une période : elles deviennent non modifiables. */
export async function validateClassTerm(ctx: ServiceContext, input: { classId: string; termId: string }) {
  if (!canAll(ctx.scope, "grade.validate")) throw new ForbiddenError();
  const res = await ctx.db.assessment.updateMany({
    where: { classId: input.classId, termId: input.termId, isLocked: false },
    data: { isLocked: true, validatedAt: new Date(), validatedById: ctx.user.id },
  });
  await audit(ctx.db, actor(ctx), {
    action: "grade.validate",
    entityType: "Class",
    entityId: input.classId,
    after: { termId: input.termId, assessments: res.count },
  });
  return res;
}

export async function unlockClassTerm(ctx: ServiceContext, input: { classId: string; termId: string }) {
  if (!canAll(ctx.scope, "grade.unlock")) throw new ForbiddenError();
  await ctx.db.assessment.updateMany({
    where: { classId: input.classId, termId: input.termId },
    data: { isLocked: false, validatedAt: null, validatedById: null },
  });
  await audit(ctx.db, actor(ctx), {
    action: "grade.unlock",
    entityType: "Class",
    entityId: input.classId,
    after: { termId: input.termId },
  });
}

// ── Résultats ──────────────────────────────────────────────────────────────

export interface SubjectResult {
  subjectId: string;
  name: string;
  coefficient: number;
  teacher: string | null;
  average: number | null;
  rank: number | null;
  classAverage: number | null;
  highest: number | null;
  lowest: number | null;
  grades: { title: string; type: AssessmentType; score: number | null; absent: boolean; outOf: number; date: Date }[];
}

export interface StudentResult {
  studentId: string;
  firstName: string;
  lastName: string;
  matricule: string;
  gender: string;
  birthDate: Date | null;
  average: number | null;
  rank: number | null;
  suggested: ReturnType<typeof suggestDistinction>;
  subjects: SubjectResult[];
}

/**
 * Résultats d'une classe pour une période : moyennes par matière (pondérées),
 * moyenne générale (coefficients du niveau / de la série), rangs et statistiques.
 */
export async function computeClassResults(ctx: ServiceContext, input: { classId: string; termId: string }) {
  if (!canOnClass(ctx.scope, "grade.read", input.classId)) throw new ForbiddenError();
  const scale = ctx.school.gradingScale;
  const cls = await found(ctx.db.class.findUnique({ where: { id: input.classId }, include: { level: true } }));
  const [enrollments, assessments, coefficients, assignments] = await Promise.all([
    ctx.db.enrollment.findMany({
      where: { classId: cls.id, status: "ACTIVE", deletedAt: null },
      include: { student: true },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    }),
    ctx.db.assessment.findMany({
      where: { classId: cls.id, termId: input.termId },
      include: { grades: { where: { deletedAt: null } } },
      orderBy: { date: "asc" },
    }),
    ctx.db.subjectCoefficient.findMany({ where: { levelId: cls.levelId, trackId: cls.trackId } }),
    ctx.db.teachingAssignment.findMany({ where: { classId: cls.id }, include: { subject: true, staff: true } }),
  ]);
  const coefOf = new Map(coefficients.map((c) => [c.subjectId, c.coefficient]));
  const subjects = assignments
    .map((a) => ({
      id: a.subjectId,
      name: a.subject.name,
      teacher: `${a.staff.firstName} ${a.staff.lastName}`,
      coefficient: coefOf.get(a.subjectId) ?? 1,
    }))
    .sort((a, b) => b.coefficient - a.coefficient || a.name.localeCompare(b.name));

  // Moyenne de chaque élève dans chaque matière
  const subjectAvg = new Map<string, Map<string, number | null>>();
  for (const subject of subjects) {
    const list = assessments.filter((a) => a.subjectId === subject.id);
    const perStudent = new Map<string, number | null>();
    for (const { studentId } of enrollments) {
      perStudent.set(
        studentId,
        subjectAverage(
          list.map((a) => {
            const g = a.grades.find((x) => x.studentId === studentId);
            return { score: g && !g.isAbsent ? g.score : null, outOf: a.outOf, weight: a.weight };
          }),
          scale,
        ),
      );
    }
    subjectAvg.set(subject.id, perStudent);
  }

  const general = new Map(
    enrollments.map((e) => [
      e.studentId,
      generalAverage(
        subjects.map((s) => ({ average: subjectAvg.get(s.id)!.get(e.studentId) ?? null, coefficient: s.coefficient })),
      ),
    ]),
  );
  const generalRanks = ranks(general);
  const subjectRanks = new Map(subjects.map((s) => [s.id, ranks(subjectAvg.get(s.id)!)]));
  const subjectStats = new Map(subjects.map((s) => [s.id, stats([...subjectAvg.get(s.id)!.values()])]));

  const students: StudentResult[] = enrollments.map(({ student }) => ({
    studentId: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    matricule: student.matricule,
    gender: student.gender,
    birthDate: student.birthDate,
    average: general.get(student.id) ?? null,
    rank: generalRanks.get(student.id) ?? null,
    suggested: suggestDistinction(general.get(student.id) ?? null, scale),
    subjects: subjects.map((s) => ({
      subjectId: s.id,
      name: s.name,
      coefficient: s.coefficient,
      teacher: s.teacher,
      average: subjectAvg.get(s.id)!.get(student.id) ?? null,
      rank: subjectRanks.get(s.id)!.get(student.id) ?? null,
      classAverage: subjectStats.get(s.id)!.average,
      highest: subjectStats.get(s.id)!.highest,
      lowest: subjectStats.get(s.id)!.lowest,
      grades: assessments
        .filter((a) => a.subjectId === s.id)
        .map((a) => {
          const g = a.grades.find((x) => x.studentId === student.id);
          return {
            title: a.title,
            type: a.type,
            score: g?.score ?? null,
            absent: g?.isAbsent ?? false,
            outOf: a.outOf,
            date: a.date,
          };
        }),
    })),
  }));

  const classStats = stats([...general.values()]);
  const locked = assessments.length > 0 && assessments.every((a) => a.isLocked);
  return { class: cls, scale, subjects, students, classStats, locked, assessmentCount: assessments.length };
}

/** Résultats d'un élève (parent, élève) : refusé si le parent n'a pas le droit de voir les notes. */
export async function studentResults(ctx: ServiceContext, input: { studentId: string; termId: string }) {
  requireStudentAccess(ctx.scope, "grade.read", input.studentId);
  // Un tuteur peut avoir été privé de l'accès aux notes par l'école.
  const link = await ctx.db.studentGuardian.findFirst({
    where: { studentId: input.studentId, guardian: { userId: ctx.user.id } },
  });
  if (link && !link.canViewGrades) throw new ForbiddenError();
  const year = await getActiveYear(ctx);
  const enrollment = await ctx.db.enrollment.findFirst({
    where: { studentId: input.studentId, academicYearId: year?.id ?? "", status: "ACTIVE", deletedAt: null },
  });
  if (!enrollment) return null;
  // Le calcul de classe donne les rangs ; on n'expose que la ligne de l'élève.
  const results = await computeClassResults(
    { ...ctx, scope: { ...ctx.scope, permissions: new Set([...ctx.scope.permissions, "grade.read"]) } },
    { classId: enrollment.classId, termId: input.termId },
  );
  return {
    class: results.class,
    scale: results.scale,
    classStats: results.classStats,
    size: results.students.length,
    student: results.students.find((s) => s.studentId === input.studentId) ?? null,
  };
}

/** Suivi des examens blancs (DEF, BAC) : moyenne et taux de réussite par classe d'examen. */
export async function mockExamStats(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "grade.read")) throw new ForbiddenError();
  const year = await getActiveYear(ctx);
  const classes = await ctx.db.class.findMany({
    where: { academicYearId: year?.id ?? "", level: { nationalExam: { not: null } } },
    include: {
      level: true,
      assessments: { where: { type: "MOCK_EXAM" }, include: { grades: { where: { deletedAt: null } }, subject: true } },
    },
  });
  const pass = ctx.school.gradingScale * 50; // la moyenne (10/20 ou 5/10), en centièmes
  return classes.map((c) => {
    const byStudent = new Map<string, number[]>();
    for (const a of c.assessments) {
      for (const g of a.grades) {
        if (g.isAbsent || g.score === null) continue;
        byStudent.set(g.studentId, [
          ...(byStudent.get(g.studentId) ?? []),
          Math.round((g.score * ctx.school.gradingScale) / a.outOf),
        ]);
      }
    }
    const averages = [...byStudent.values()].map((v) => Math.round(v.reduce((x, y) => x + y, 0) / v.length));
    return {
      classId: c.id,
      className: c.name,
      exam: c.level.nationalExam!,
      mockExams: new Set(c.assessments.map((a) => a.title)).size,
      candidates: averages.length,
      average: stats(averages).average,
      passRate: averages.length ? Math.round((averages.filter((a) => a >= pass).length / averages.length) * 100) : null,
    };
  });
}
