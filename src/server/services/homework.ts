import "server-only";
import type { Prisma } from "@prisma/client";
import { DomainError, NotFoundError } from "@/server/errors";
import { can, canAll, ForbiddenError, requireClassAccess, requireStudentAccess } from "@/server/rbac/policies";
import { addDays, dayStart } from "@/lib/time";
import { paginate, type ServiceContext } from "./context";
import { notifyGuardians, notifyUser } from "./notify";
import { found, getActiveYear } from "./structure";
import { storeDocument } from "./students";

/** Le professeur connecté enseigne cette matière dans cette classe. */
async function requireTeaching(ctx: ServiceContext, classId: string, subjectId: string) {
  if (!ctx.staffId) throw new ForbiddenError();
  const assignment = await ctx.db.teachingAssignment.findFirst({
    where: { classId, subjectId, staffId: ctx.staffId },
  });
  if (!assignment) throw new ForbiddenError();
  return ctx.staffId;
}

/** Matières enseignées par le professeur connecté (pour les formulaires). */
export async function myAssignments(ctx: ServiceContext) {
  if (!ctx.staffId) return [];
  const year = await getActiveYear(ctx);
  return ctx.db.teachingAssignment.findMany({
    where: { staffId: ctx.staffId, academicYearId: year?.id ?? "" },
    include: { class: true, subject: true },
    orderBy: [{ class: { name: "asc" } }, { subject: { name: "asc" } }],
  });
}

// ── Cahier de textes ───────────────────────────────────────────────────────

export async function saveLesson(
  ctx: ServiceContext,
  input: { id?: string; classId: string; subjectId: string; date: Date; title: string; content: string },
) {
  const staffId = await requireTeaching(ctx, input.classId, input.subjectId);
  if (input.date > addDays(dayStart(), 1)) throw new DomainError("futureDate", "date");
  const data = {
    classId: input.classId,
    subjectId: input.subjectId,
    date: input.date,
    title: input.title,
    content: input.content,
  };
  if (input.id) {
    const lesson = await found(ctx.db.lesson.findUnique({ where: { id: input.id } }));
    if (lesson.staffId !== staffId) throw new ForbiddenError();
    return ctx.db.lesson.update({ where: { id: lesson.id }, data });
  }
  return ctx.db.lesson.create({ data: { schoolId: ctx.school.id, staffId, ...data } });
}

export async function listLessons(ctx: ServiceContext, filters: { classId?: string; page?: number }) {
  const { skip, take, page } = paginate(filters.page);
  const where: Prisma.LessonWhereInput = {
    ...(canAll(ctx.scope, "homework.read") ? {} : { classId: { in: [...ctx.scope.classIds] } }),
    ...(filters.classId ? { classId: filters.classId } : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.lesson.findMany({
      where,
      include: { class: true, subject: true, staff: true, homeworks: { where: { deletedAt: null } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    ctx.db.lesson.count({ where }),
  ]);
  return { items, total, page };
}

// ── Devoirs : professeur ───────────────────────────────────────────────────

export interface HomeworkInput {
  classId: string;
  subjectId: string;
  title: string;
  instructions: string;
  link?: string | null;
  dueAt: Date;
  allowSubmission: boolean;
  lessonId?: string | null;
  files?: File[];
}

/** Publie un devoir ; élèves et parents sont prévenus dans l'application. */
export async function createHomework(ctx: ServiceContext, input: HomeworkInput) {
  const staffId = await requireTeaching(ctx, input.classId, input.subjectId);
  if (input.dueAt < new Date()) throw new DomainError("dueInPast", "dueAt");
  if (input.lessonId) {
    const lesson = await found(ctx.db.lesson.findUnique({ where: { id: input.lessonId } }));
    if (lesson.classId !== input.classId) throw new DomainError("invalid", "lessonId");
  }
  const homework = await ctx.db.homework.create({
    data: {
      schoolId: ctx.school.id,
      staffId,
      classId: input.classId,
      subjectId: input.subjectId,
      lessonId: input.lessonId ?? null,
      title: input.title,
      instructions: input.instructions,
      link: input.link ?? null,
      dueAt: input.dueAt,
      allowSubmission: input.allowSubmission,
      publishedAt: new Date(),
    },
    include: { subject: true },
  });
  for (const file of input.files ?? []) {
    await storeDocument(ctx, { entityType: "Homework", entityId: homework.id, category: "ATTACHMENT", file });
  }

  const due = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(input.dueAt);
  const message = {
    type: "homework.published",
    title: `Nouveau devoir — ${homework.subject.name}`,
    body: `${homework.title} (pour ${due})`,
    link: `/${ctx.school.slug}/homework/${homework.id}`,
  };
  const enrolled = await ctx.db.enrollment.findMany({
    where: { classId: input.classId, status: "ACTIVE", deletedAt: null },
    include: { student: { include: { user: true } } },
  });
  for (const { student } of enrolled) {
    if (student.user && student.accountEnabled) await notifyUser(ctx, student.user, message, []);
    await notifyGuardians(ctx, student.id, message, []);
  }
  return homework;
}

export async function deleteHomework(ctx: ServiceContext, id: string) {
  const hw = await found(ctx.db.homework.findFirst({ where: { id, deletedAt: null } }));
  if (hw.staffId !== ctx.staffId && !canAll(ctx.scope, "homework.read")) throw new ForbiddenError();
  await ctx.db.homework.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Note (en centièmes) et commentaire d'un travail rendu ; l'élève est prévenu. */
export async function gradeSubmission(
  ctx: ServiceContext,
  input: { submissionId: string; score?: number | null; feedback?: string | null },
) {
  const submission = await found(
    ctx.db.homeworkSubmission.findUnique({
      where: { id: input.submissionId },
      include: { homework: { include: { subject: true } }, student: { include: { user: true } } },
    }),
  );
  await requireTeaching(ctx, submission.homework.classId, submission.homework.subjectId);
  const max = ctx.school.gradingScale * 100;
  if (input.score !== undefined && input.score !== null && (input.score < 0 || input.score > max)) {
    throw new DomainError("scoreOutOfRange", "score");
  }
  await ctx.db.homeworkSubmission.update({
    where: { id: submission.id },
    data: { score: input.score ?? null, feedback: input.feedback ?? null, status: "GRADED", gradedAt: new Date() },
  });
  const message = {
    type: "homework.graded",
    title: `Devoir corrigé — ${submission.homework.subject.name}`,
    body: submission.homework.title,
    link: `/${ctx.school.slug}/homework/${submission.homeworkId}`,
  };
  if (submission.student.user) await notifyUser(ctx, submission.student.user, message, []);
  await notifyGuardians(ctx, submission.studentId, message, []);
}

// ── Devoirs : lecture ──────────────────────────────────────────────────────

/** Classe actuelle (année active) de chaque élève donné. */
async function currentClasses(ctx: ServiceContext, studentIds: string[]) {
  const year = await getActiveYear(ctx);
  const enrollments = await ctx.db.enrollment.findMany({
    where: { studentId: { in: studentIds }, academicYearId: year?.id ?? "", status: "ACTIVE", deletedAt: null },
    include: { student: true, class: true },
  });
  return enrollments;
}

/**
 * Devoirs visibles : tous (vie scolaire), ceux des classes du professeur, ou
 * ceux de la classe de l'élève / des enfants avec leur état.
 */
export async function listHomework(
  ctx: ServiceContext,
  filters: { classId?: string; upcoming?: boolean; page?: number },
) {
  const { skip, take, page } = paginate(filters.page);
  const now = new Date();
  const base: Prisma.HomeworkWhereInput = {
    deletedAt: null,
    publishedAt: { not: null },
    ...(filters.upcoming === false ? { dueAt: { lt: dayStart(now) } } : { dueAt: { gte: dayStart(now) } }),
  };

  if (
    ctx.scope.permissions.has("homework.read:own") &&
    ctx.scope.studentIds.size > 0 &&
    ctx.scope.classIds.size === 0
  ) {
    // Parent ou élève : devoirs de la classe de chaque enfant, avec leur état.
    const enrollments = await currentClasses(ctx, [...ctx.scope.studentIds]);
    const items = await ctx.db.homework.findMany({
      where: { ...base, classId: { in: enrollments.map((e) => e.classId) } },
      include: { subject: true, class: true, submissions: { where: { studentId: { in: [...ctx.scope.studentIds] } } } },
      orderBy: { dueAt: filters.upcoming === false ? "desc" : "asc" },
      take: 100,
    });
    const children = enrollments.map((e) => ({
      student: e.student,
      items: items
        .filter((h) => h.classId === e.classId)
        .map((h) => ({ ...h, submission: h.submissions.find((s) => s.studentId === e.studentId) ?? null })),
    }));
    return { mode: "family" as const, children };
  }

  const where: Prisma.HomeworkWhereInput = {
    ...base,
    ...(canAll(ctx.scope, "homework.read") ? {} : { classId: { in: [...ctx.scope.classIds] } }),
    ...(filters.classId ? { classId: filters.classId } : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.homework.findMany({
      where,
      include: {
        subject: true,
        class: { include: { _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } } } },
        staff: true,
        _count: { select: { submissions: { where: { status: { in: ["DONE", "SUBMITTED", "GRADED"] } } } } },
      },
      orderBy: { dueAt: filters.upcoming === false ? "desc" : "asc" },
      skip,
      take,
    }),
    ctx.db.homework.count({ where }),
  ]);
  return { mode: "staff" as const, items, total, page };
}

/** Un devoir, ses pièces jointes, et les rendus (professeur) ou le rendu de l'enfant. */
export async function getHomework(ctx: ServiceContext, id: string) {
  const hw = await ctx.db.homework.findFirst({
    where: { id, deletedAt: null },
    include: { subject: true, class: true, staff: true, lesson: true },
  });
  if (!hw) throw new NotFoundError();
  const staffView = canAll(ctx.scope, "homework.read") || ctx.scope.classIds.has(hw.classId);
  const familyIds = staffView ? [] : [...ctx.scope.studentIds];
  if (!staffView) {
    const enrollments = await currentClasses(ctx, familyIds);
    if (!enrollments.some((e) => e.classId === hw.classId)) throw new ForbiddenError();
  }

  const attachments = await ctx.db.document.findMany({
    where: { entityType: "Homework", entityId: hw.id, deletedAt: null },
  });
  const submissions = await ctx.db.homeworkSubmission.findMany({
    where: { homeworkId: hw.id, ...(staffView ? {} : { studentId: { in: familyIds } }) },
    include: { student: true },
    orderBy: { student: { lastName: "asc" } },
  });
  const submissionFiles = await ctx.db.document.findMany({
    where: { entityType: "HomeworkSubmission", entityId: { in: submissions.map((s) => s.id) }, deletedAt: null },
  });
  const roster = staffView
    ? await ctx.db.enrollment.findMany({
        where: { classId: hw.classId, status: "ACTIVE", deletedAt: null },
        include: { student: true },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      })
    : (await currentClasses(ctx, familyIds)).filter((e) => e.classId === hw.classId);

  return {
    ...hw,
    staffView,
    canGrade: Boolean(ctx.staffId && hw.staffId === ctx.staffId) || (staffView && can(ctx.scope, "homework.write")),
    attachments,
    rows: roster.map((e) => {
      const submission = submissions.find((s) => s.studentId === e.studentId) ?? null;
      return {
        student: e.student,
        submission,
        files: submission ? submissionFiles.filter((f) => f.entityId === submission.id) : [],
      };
    }),
  };
}

/** Nombre de devoirs à rendre par jour pour une classe (éviter les journées surchargées). */
export async function homeworkLoad(ctx: ServiceContext, classId: string, from: Date, days = 14) {
  requireClassAccess(ctx.scope, "homework.read", classId);
  const items = await ctx.db.homework.findMany({
    where: { classId, deletedAt: null, publishedAt: { not: null }, dueAt: { gte: from, lt: addDays(from, days) } },
    include: { subject: true },
    orderBy: { dueAt: "asc" },
  });
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    const list = items.filter((h) => dayStart(h.dueAt).getTime() === day.getTime());
    return { date: day, items: list.map((h) => ({ id: h.id, title: h.title, subject: h.subject.name })) };
  });
}

// ── Devoirs : élève ────────────────────────────────────────────────────────

async function requireStudentHomework(ctx: ServiceContext, homeworkId: string, studentId: string) {
  requireStudentAccess(ctx.scope, "homework.submit", studentId);
  const hw = await found(
    ctx.db.homework.findFirst({ where: { id: homeworkId, deletedAt: null, publishedAt: { not: null } } }),
  );
  const year = await getActiveYear(ctx);
  const enrolled = await ctx.db.enrollment.findFirst({
    where: { studentId, classId: hw.classId, academicYearId: year?.id ?? "", status: "ACTIVE", deletedAt: null },
  });
  if (!enrolled) throw new ForbiddenError();
  return hw;
}

/** L'élève coche « fait » (ou décoche). */
export async function markHomeworkDone(
  ctx: ServiceContext,
  input: { homeworkId: string; studentId: string; done: boolean },
) {
  await requireStudentHomework(ctx, input.homeworkId, input.studentId);
  const existing = await ctx.db.homeworkSubmission.findFirst({
    where: { homeworkId: input.homeworkId, studentId: input.studentId },
  });
  if (existing && (existing.status === "SUBMITTED" || existing.status === "GRADED")) return existing;
  const status = input.done ? "DONE" : "TODO";
  if (existing) return ctx.db.homeworkSubmission.update({ where: { id: existing.id }, data: { status } });
  return ctx.db.homeworkSubmission.create({
    data: { schoolId: ctx.school.id, homeworkId: input.homeworkId, studentId: input.studentId, status },
  });
}

/** L'élève dépose son travail (texte et/ou fichiers). Un nouveau dépôt remplace le texte précédent. */
export async function submitHomework(
  ctx: ServiceContext,
  input: { homeworkId: string; studentId: string; content?: string | null; files?: File[] },
) {
  const hw = await requireStudentHomework(ctx, input.homeworkId, input.studentId);
  if (!hw.allowSubmission) throw new DomainError("submissionClosed");
  if (!input.content && !input.files?.length) throw new DomainError("emptySubmission", "content");
  const existing = await ctx.db.homeworkSubmission.findFirst({
    where: { homeworkId: hw.id, studentId: input.studentId },
  });
  if (existing?.status === "GRADED") throw new DomainError("alreadyGraded");
  const data = {
    status: "SUBMITTED" as const,
    content: input.content ?? existing?.content ?? null,
    submittedAt: new Date(),
  };
  const submission = existing
    ? await ctx.db.homeworkSubmission.update({ where: { id: existing.id }, data })
    : await ctx.db.homeworkSubmission.create({
        data: { schoolId: ctx.school.id, homeworkId: hw.id, studentId: input.studentId, ...data },
      });
  for (const file of input.files ?? []) {
    await storeDocument(ctx, {
      entityType: "HomeworkSubmission",
      entityId: submission.id,
      category: "SUBMISSION",
      file,
    });
  }
  return submission;
}
