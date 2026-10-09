import "server-only";
import type { PaymentMethod } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { addDays } from "@/lib/time";
import { actor, paginate, type ServiceContext } from "../context";
import { found, requireActiveYear } from "../structure";

function requireRead(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "finance.read")) throw new ForbiddenError();
}

// ── Dépenses ───────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  "Salaires",
  "Fournitures",
  "Électricité",
  "Eau",
  "Loyer",
  "Entretien",
  "Transport",
  "Cantine",
  "Autre",
] as const;

export async function createExpense(
  ctx: ServiceContext,
  input: {
    category: string;
    label: string;
    amount: number;
    method: PaymentMethod;
    reference?: string | null;
    spentAt: Date;
  },
) {
  if (!canAll(ctx.scope, "expense.write")) throw new ForbiddenError();
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("invalidAmount", "amount");
  return ctx.db.expense.create({
    data: { schoolId: ctx.school.id, recordedById: ctx.user.id, ...input, reference: input.reference ?? null },
  });
}

export async function deleteExpense(ctx: ServiceContext, id: string) {
  if (!canAll(ctx.scope, "expense.write")) throw new ForbiddenError();
  const expense = await found(ctx.db.expense.findFirst({ where: { id, deletedAt: null } }));
  await ctx.db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx.db, actor(ctx), { action: "expense.delete", entityType: "Expense", entityId: id, before: expense });
}

export async function listExpenses(ctx: ServiceContext, filters: { from: Date; to: Date; page?: number }) {
  requireRead(ctx);
  const { skip, take, page } = paginate(filters.page);
  const where = { deletedAt: null, spentAt: { gte: filters.from, lt: filters.to } };
  const [items, total, byCategory] = await Promise.all([
    ctx.db.expense.findMany({ where, orderBy: { spentAt: "desc" }, skip, take }),
    ctx.db.expense.count({ where }),
    ctx.db.expense.groupBy({ by: ["category"], where, _sum: { amount: true } }),
  ]);
  return {
    items,
    total,
    page,
    byCategory: byCategory
      .map((c) => ({ category: c.category, amount: c._sum.amount ?? 0 }))
      .sort((a, b) => b.amount - a.amount),
    sum: byCategory.reduce((t, c) => t + (c._sum.amount ?? 0), 0),
  };
}

// ── Caisse journalière ─────────────────────────────────────────────────────

/** Encaissements et dépenses du jour par mode ; espèces attendues en caisse. */
export async function dailyCash(ctx: ServiceContext, date: Date) {
  requireRead(ctx);
  const next = addDays(date, 1);
  const [payments, expenses, closing] = await Promise.all([
    ctx.db.payment.groupBy({
      by: ["method"],
      where: { status: "COMPLETED", deletedAt: null, paidAt: { gte: date, lt: next } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    ctx.db.expense.groupBy({
      by: ["method"],
      where: { deletedAt: null, spentAt: { gte: date, lt: next } },
      _sum: { amount: true },
    }),
    ctx.db.cashClosing.findFirst({ where: { date } }),
  ]);
  const inBy = (m: PaymentMethod) => payments.find((p) => p.method === m)?._sum.amount ?? 0;
  const outBy = (m: PaymentMethod) => expenses.find((e) => e.method === m)?._sum.amount ?? 0;
  const methods = ["CASH", "CHEQUE", "TRANSFER", "MOBILE_MONEY"] as const;
  return {
    date,
    byMethod: methods.map((m) => ({ method: m, in: inBy(m), out: outBy(m) })),
    totalIn: payments.reduce((t, p) => t + (p._sum.amount ?? 0), 0),
    totalOut: expenses.reduce((t, e) => t + (e._sum.amount ?? 0), 0),
    count: payments.reduce((t, p) => t + p._count._all, 0),
    expectedCash: inBy("CASH") - outBy("CASH"),
    closing,
  };
}

/** Clôture de caisse : comptage réel comparé aux espèces attendues. Une seule par jour. */
export async function closeCash(ctx: ServiceContext, input: { date: Date; countedCash: number; note?: string | null }) {
  if (!canAll(ctx.scope, "payment.write")) throw new ForbiddenError();
  const day = await dailyCash(ctx, input.date);
  if (day.closing) throw new DomainError("alreadyClosed");
  const difference = input.countedCash - day.expectedCash;
  if (difference !== 0 && !input.note) throw new DomainError("differenceNeedsNote", "note");
  const closing = await ctx.db.cashClosing.create({
    data: {
      schoolId: ctx.school.id,
      date: input.date,
      expectedCash: day.expectedCash,
      countedCash: input.countedCash,
      difference,
      note: input.note ?? null,
      closedById: ctx.user.id,
    },
  });
  await audit(ctx.db, actor(ctx), {
    action: "cash.close",
    entityType: "CashClosing",
    entityId: closing.id,
    after: closing,
  });
  return closing;
}

// ── Tableau de bord ────────────────────────────────────────────────────────

/** Attendu vs encaissé, recouvrement, impayés par classe, plus gros retards. */
export async function financeOverview(ctx: ServiceContext) {
  requireRead(ctx);
  const year = await requireActiveYear(ctx);
  const now = new Date();
  const invoiceWhere = { academicYearId: year.id, status: { not: "CANCELLED" as const }, deletedAt: null };
  const [totals, overdueRows, classes, monthly, expenses] = await Promise.all([
    ctx.db.invoice.aggregate({ where: invoiceWhere, _sum: { total: true, amountPaid: true } }),
    ctx.db.invoice.findMany({
      where: { ...invoiceWhere, status: { in: ["UNPAID", "PARTIAL"] }, dueDate: { lte: now } },
      select: { studentId: true, total: true, amountPaid: true, lastReminderAt: true },
    }),
    ctx.db.class.findMany({
      where: { academicYearId: year.id },
      include: { enrollments: { where: { status: "ACTIVE", deletedAt: null }, select: { studentId: true } } },
      orderBy: { name: "asc" },
    }),
    ctx.db.payment.findMany({
      where: { status: "COMPLETED", deletedAt: null, paidAt: { gte: year.startDate } },
      select: { amount: true, paidAt: true },
    }),
    ctx.db.expense.aggregate({ where: { deletedAt: null, spentAt: { gte: year.startDate } }, _sum: { amount: true } }),
  ]);

  const overdueByStudent = new Map<string, number>();
  for (const r of overdueRows)
    overdueByStudent.set(r.studentId, (overdueByStudent.get(r.studentId) ?? 0) + r.total - r.amountPaid);

  const perStudent = await ctx.db.invoice.groupBy({
    by: ["studentId"],
    where: invoiceWhere,
    _sum: { total: true, amountPaid: true },
  });
  const sums = new Map(
    perStudent.map((p) => [p.studentId, { total: p._sum.total ?? 0, paid: p._sum.amountPaid ?? 0 }]),
  );
  const byClass = classes.map((c) => {
    const ids = c.enrollments.map((e) => e.studentId);
    const expected = ids.reduce((t, id) => t + (sums.get(id)?.total ?? 0), 0);
    const collected = ids.reduce((t, id) => t + (sums.get(id)?.paid ?? 0), 0);
    const overdue = ids.reduce((t, id) => t + (overdueByStudent.get(id) ?? 0), 0);
    return {
      classId: c.id,
      name: c.name,
      expected,
      collected,
      overdue,
      debtors: ids.filter((id) => overdueByStudent.has(id)).length,
    };
  });

  const months = new Map<string, number>();
  for (const p of monthly) {
    const key = p.paidAt.toISOString().slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + p.amount);
  }

  const expected = totals._sum.total ?? 0;
  const collected = totals._sum.amountPaid ?? 0;
  const overdue = [...overdueByStudent.values()].reduce((a, b) => a + b, 0);
  return {
    year,
    expected,
    collected,
    outstanding: expected - collected,
    overdue,
    rate: expected ? Math.round((collected / expected) * 1000) / 10 : null,
    expenses: expenses._sum.amount ?? 0,
    byClass,
    byMonth: [...months.entries()].sort().map(([month, amount]) => ({ month, amount })),
    debtorCount: overdueByStudent.size,
  };
}

/** Élèves ayant un impayé échu, du plus gros au plus petit. */
export async function listDebtors(ctx: ServiceContext, filters: { classId?: string; page?: number }) {
  requireRead(ctx);
  const year = await requireActiveYear(ctx);
  const rows = await ctx.db.invoice.groupBy({
    by: ["studentId"],
    where: {
      academicYearId: year.id,
      status: { in: ["UNPAID", "PARTIAL"] },
      deletedAt: null,
      dueDate: { lte: new Date() },
    },
    _sum: { total: true, amountPaid: true },
    _max: { lastReminderAt: true },
  });
  const debts = rows
    .map((r) => ({
      studentId: r.studentId,
      amount: (r._sum.total ?? 0) - (r._sum.amountPaid ?? 0),
      lastReminderAt: r._max.lastReminderAt,
    }))
    .filter((r) => r.amount > 0);
  const students = await ctx.db.student.findMany({
    where: {
      id: { in: debts.map((d) => d.studentId) },
      ...(filters.classId ? { enrollments: { some: { classId: filters.classId, academicYearId: year.id } } } : {}),
    },
    include: {
      enrollments: { where: { academicYearId: year.id }, include: { class: true } },
      guardians: { where: { isPrimary: true }, include: { guardian: true } },
    },
  });
  const list = students
    .map((s) => ({ student: s, ...debts.find((d) => d.studentId === s.id)! }))
    .sort((a, b) => b.amount - a.amount);
  const { skip, take, page } = paginate(filters.page);
  return {
    items: list.slice(skip, skip + take),
    total: list.length,
    page,
    sum: list.reduce((t, x) => t + x.amount, 0),
  };
}
