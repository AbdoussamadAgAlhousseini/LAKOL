import "server-only";
import type { SchoolContext } from "@/server/context";
import { canAll } from "@/server/rbac/policies";
import { computeClassResults, studentResults } from "./assessments";
import { lowStockCount } from "./modules/inventory";

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

// ── Indicateurs avancés ────────────────────────────────────────────────────

const WEEK = 7 * 86_400_000;

/** Lundi (UTC) de la semaine d'une date. */
function mondayOf(d: Date) {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() + 6) % 7));
  return r;
}

/** Période en cours de l'année active (ou la dernière commencée). */
async function currentTermOf(ctx: SchoolContext) {
  const now = new Date();
  const terms = await ctx.db.term.findMany({
    where: { academicYear: { isActive: true } },
    orderBy: { order: "asc" },
  });
  return (
    terms.find((t) => t.startDate <= now && t.endDate >= now) ??
    terms.filter((t) => t.startDate <= now).at(-1) ??
    terms[0] ??
    null
  );
}

/**
 * Direction : taux de présence des 8 dernières semaines, moyenne générale par
 * classe sur la période en cours, et alertes (élèves en difficulté, absences
 * répétées, impayés, stocks, livres en retard).
 */
export async function getSchoolInsights(ctx: SchoolContext) {
  const year = await activeYear(ctx);
  if (!year) return null;
  const { db } = ctx;
  const out: {
    attendance: { weekStart: Date; rate: number | null }[] | null;
    results: { classId: string; className: string; average: number | null }[] | null;
    termName: string | null;
    scale: number;
    alerts: { key: string; count: number; href: string }[];
  } = { attendance: null, results: null, termName: null, scale: ctx.school.gradingScale, alerts: [] };

  if (canAll(ctx.scope, "attendance.read")) {
    const from = new Date(mondayOf(new Date()).getTime() - 7 * WEEK);
    const rows = await db.attendance.findMany({
      where: { date: { gte: from } },
      select: { date: true, status: true, studentId: true },
    });
    out.attendance = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(from.getTime() + i * WEEK);
      const week = rows.filter((r) => r.date >= start && r.date < new Date(start.getTime() + WEEK));
      const present = week.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
      return { weekStart: start, rate: week.length ? Math.round((present / week.length) * 1000) / 10 : null };
    });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const absences = new Map<string, number>();
    for (const r of rows)
      if (r.status === "ABSENT" && r.date >= since) absences.set(r.studentId, (absences.get(r.studentId) ?? 0) + 1);
    const frequent = [...absences.values()].filter((n) => n >= 3).length;
    if (frequent) out.alerts.push({ key: "frequentAbsences", count: frequent, href: "attendance" });
  }

  if (canAll(ctx.scope, "grade.read")) {
    const term = await currentTermOf(ctx);
    if (term) {
      out.termName = term.name;
      const classes = await db.class.findMany({ where: { academicYearId: year.id }, orderBy: { name: "asc" } });
      const struggling = new Set<string>();
      out.results = [];
      for (const cls of classes) {
        const r = await computeClassResults(ctx, { classId: cls.id, termId: term.id });
        out.results.push({ classId: cls.id, className: cls.name, average: r.classStats.average });
        for (const s of r.students) if (s.average !== null && s.average < r.scale * 50) struggling.add(s.studentId);
      }
      if (struggling.size) out.alerts.push({ key: "struggling", count: struggling.size, href: "grades" });
    }
  }

  if (canAll(ctx.scope, "finance.read")) {
    const debtors = await db.invoice.groupBy({
      by: ["studentId"],
      where: {
        academicYearId: year.id,
        status: { in: ["UNPAID", "PARTIAL"] },
        deletedAt: null,
        dueDate: { lte: new Date() },
      },
    });
    if (debtors.length) out.alerts.push({ key: "debtors", count: debtors.length, href: "finance/debtors" });
  }
  const lowStock = await lowStockCount(ctx);
  if (lowStock) out.alerts.push({ key: "lowStock", count: lowStock, href: "inventory" });
  if (canAll(ctx.scope, "library.manage")) {
    const late = await db.bookLoan.count({ where: { returnedAt: null, dueAt: { lt: new Date() } } });
    if (late) out.alerts.push({ key: "lateLoans", count: late, href: "library" });
  }
  return out;
}

/** Professeur : travaux déposés à corriger dans ses devoirs. */
export async function getTeacherInsights(ctx: SchoolContext) {
  if (!ctx.staffId) return { toCorrect: 0 };
  const toCorrect = await ctx.db.homeworkSubmission.count({
    where: { status: "SUBMITTED", homework: { staffId: ctx.staffId, deletedAt: null } },
  });
  return { toCorrect };
}

/** Famille : moyenne générale de l'enfant à chaque période de l'année (graphique de progression). */
export async function getStudentProgress(ctx: SchoolContext, studentId: string) {
  const terms = await ctx.db.term.findMany({
    where: { academicYear: { isActive: true }, startDate: { lte: new Date() } },
    orderBy: { order: "asc" },
  });
  const points = [];
  for (const term of terms) {
    const r = await studentResults(ctx, { studentId, termId: term.id }).catch(() => null);
    points.push({ term: term.name, average: r?.student?.average ?? null, classAverage: r?.classStats.average ?? null });
  }
  return { scale: ctx.school.gradingScale, points };
}
