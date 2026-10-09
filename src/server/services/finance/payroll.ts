import "server-only";
import type { PaymentMethod } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { actor, type ServiceContext } from "../context";
import { found } from "../structure";

function requirePayroll(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "payroll.manage")) throw new ForbiddenError();
}

/** Net = salaire de base + heures de vacation × taux + primes − retenues. */
export function computeNet(p: {
  baseAmount: number;
  hoursMinutes: number;
  hourlyRate: number;
  bonuses: number;
  deductions: number;
}) {
  const hourlyAmount = Math.round((p.hoursMinutes * p.hourlyRate) / 60);
  return { hourlyAmount, netAmount: p.baseAmount + hourlyAmount + p.bonuses - p.deductions };
}

/** Prépare la paie du mois pour le personnel en poste (sans écraser ce qui existe). */
export async function preparePayroll(ctx: ServiceContext, period: string) {
  requirePayroll(ctx);
  if (!/^\d{4}-\d{2}$/.test(period)) throw new DomainError("invalid", "period");
  const staff = await ctx.db.staff.findMany({ where: { isActive: true, deletedAt: null } });
  let created = 0;
  for (const s of staff) {
    if (!s.monthlySalary && !s.hourlyRate) continue;
    if (await ctx.db.payroll.findFirst({ where: { staffId: s.id, period } })) continue;
    const base = s.contractType === "PERMANENT" ? (s.monthlySalary ?? 0) : 0;
    await ctx.db.payroll.create({
      data: { schoolId: ctx.school.id, staffId: s.id, period, baseAmount: base, netAmount: base },
    });
    created += 1;
  }
  return { created };
}

export async function listPayroll(ctx: ServiceContext, period: string) {
  requirePayroll(ctx);
  return ctx.db.payroll.findMany({
    where: { period, deletedAt: null },
    include: { staff: true },
    orderBy: { staff: { lastName: "asc" } },
  });
}

export async function updatePayroll(
  ctx: ServiceContext,
  input: { id: string; hoursMinutes: number; bonuses: number; deductions: number },
) {
  requirePayroll(ctx);
  const payroll = await found(
    ctx.db.payroll.findFirst({ where: { id: input.id, deletedAt: null }, include: { staff: true } }),
  );
  if (payroll.status === "PAID") throw new DomainError("payrollPaid");
  const { hourlyAmount, netAmount } = computeNet({ ...payroll, ...input, hourlyRate: payroll.staff.hourlyRate ?? 0 });
  if (netAmount < 0) throw new DomainError("invalidAmount", "deductions");
  await ctx.db.payroll.update({ where: { id: payroll.id }, data: { ...input, hourlyAmount, netAmount } });
}

/** Paiement d'un salaire : statut payé + dépense « Salaires ». Tracé. */
export async function payPayroll(ctx: ServiceContext, input: { id: string; method: PaymentMethod }) {
  requirePayroll(ctx);
  const payroll = await found(
    ctx.db.payroll.findFirst({ where: { id: input.id, deletedAt: null }, include: { staff: true } }),
  );
  if (payroll.status === "PAID") throw new DomainError("payrollPaid");
  if (payroll.netAmount <= 0) throw new DomainError("invalidAmount");
  const now = new Date();
  await ctx.db.$transaction([
    ctx.db.payroll.update({ where: { id: payroll.id }, data: { status: "PAID", paidAt: now } }),
    ctx.db.expense.create({
      data: {
        schoolId: ctx.school.id,
        category: "Salaires",
        label: `Salaire ${payroll.period} — ${payroll.staff.firstName} ${payroll.staff.lastName}`,
        amount: payroll.netAmount,
        method: input.method,
        spentAt: now,
        recordedById: ctx.user.id,
      },
    }),
  ]);
  await audit(ctx.db, actor(ctx), {
    action: "payroll.pay",
    entityType: "Staff",
    entityId: payroll.staffId,
    after: { period: payroll.period, net: payroll.netAmount, method: input.method },
  });
}
