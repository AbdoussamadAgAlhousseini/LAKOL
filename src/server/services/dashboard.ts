import "server-only";
import type { SchoolContext } from "@/server/context";
import { canAll } from "@/server/rbac/policies";

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function activeYear(ctx: SchoolContext) {
  return ctx.db.academicYear.findFirst({ where: { isActive: true } });
}

export async function getSchoolOverview(ctx: SchoolContext) {
  const year = await activeYear(ctx);
  if (!year) return null;
  const { db } = ctx;
  const [students, staff, classes, absencesToday] = await Promise.all([
    db.enrollment.count({ where: { academicYearId: year.id, status: "ACTIVE", deletedAt: null } }),
    db.staff.count({ where: { isActive: true, deletedAt: null } }),
    db.class.count({ where: { academicYearId: year.id } }),
    db.attendance.count({ where: { date: startOfToday(), status: "ABSENT" } }),
  ]);

  let finance: { expected: number; collected: number } | null = null;
  if (canAll(ctx.scope, "finance.read")) {
    const sums = await db.invoice.aggregate({
      where: { academicYearId: year.id, status: { not: "CANCELLED" }, deletedAt: null },
      _sum: { total: true, amountPaid: true },
    });
    finance = { expected: sums._sum.total ?? 0, collected: sums._sum.amountPaid ?? 0 };
  }
  return { year: year.name, students, staff, classes, absencesToday, finance };
}

export async function getTeacherClasses(ctx: SchoolContext) {
  if (ctx.scope.classIds.size === 0) return [];
  const classes = await ctx.db.class.findMany({
    where: { id: { in: [...ctx.scope.classIds] } },
    include: {
      level: true,
      teachingAssignments: { where: { staffId: ctx.staffId ?? "" }, include: { subject: true } },
      _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
    },
    orderBy: [{ level: { order: "asc" } }, { name: "asc" }],
  });
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    students: c._count.enrollments,
    subjects: c.teachingAssignments.map((a) => a.subject.name),
    isHead: c.headTeacherId === ctx.staffId,
  }));
}

/** Vue rapide par enfant (parent) ou de soi-même (élève). */
export async function getStudentCards(ctx: SchoolContext) {
  if (ctx.scope.studentIds.size === 0) return [];
  const year = await activeYear(ctx);
  const ids = [...ctx.scope.studentIds];
  const { db } = ctx;

  const students = await db.student.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      enrollments: {
        where: { academicYearId: year?.id ?? "", status: "ACTIVE", deletedAt: null },
        include: { class: true },
      },
      guardians: { where: { guardian: { userId: ctx.user.id } } },
    },
    orderBy: { firstName: "asc" },
  });

  return Promise.all(
    students.map(async (s) => {
      const classId = s.enrollments[0]?.classId;
      const link = s.guardians[0];
      const canGrades = ctx.activeRole !== "PARENT" || (link?.canViewGrades ?? false);
      const canFinance = ctx.activeRole === "PARENT" && (link?.canViewFinance ?? false);

      const [latestGrade, homeworkDue, absences, invoices] = await Promise.all([
        canGrades
          ? db.grade.findFirst({
              where: { studentId: s.id, deletedAt: null, isAbsent: false, score: { not: null } },
              include: { assessment: { include: { subject: true } } },
              orderBy: { assessment: { date: "desc" } },
            })
          : null,
        classId
          ? db.homework.count({
              where: {
                classId,
                deletedAt: null,
                publishedAt: { not: null },
                dueAt: { gte: new Date() },
                submissions: { none: { studentId: s.id, status: { in: ["DONE", "SUBMITTED", "GRADED"] } } },
              },
            })
          : 0,
        db.attendance.count({
          where: { studentId: s.id, status: "ABSENT", ...(year ? { date: { gte: year.startDate } } : {}) },
        }),
        canFinance
          ? db.invoice.aggregate({
              where: { studentId: s.id, status: { not: "CANCELLED" }, deletedAt: null },
              _sum: { total: true, amountPaid: true },
            })
          : null,
      ]);

      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
        className: s.enrollments[0]?.class.name ?? null,
        latestGrade: latestGrade
          ? {
              score: latestGrade.score!,
              outOf: latestGrade.assessment.outOf,
              subject: latestGrade.assessment.subject.name,
            }
          : null,
        homeworkDue,
        absences,
        balance: invoices ? (invoices._sum.total ?? 0) - (invoices._sum.amountPaid ?? 0) : null,
      };
    }),
  );
}
