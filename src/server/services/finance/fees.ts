import "server-only";
import type { DiscountKind, FeeCategory, FeeFrequency, Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { nextSequence } from "@/server/db/sequence";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { applyBasisPoints } from "@/lib/money";
import { actor, type ServiceContext } from "../context";
import { found, requireActiveYear } from "../structure";

function requireFees(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "fee.manage")) throw new ForbiddenError();
}

export interface Installment {
  label: string;
  dueDate: string; // AAAA-MM-JJ
}

// ── Types de frais et grilles ──────────────────────────────────────────────

export async function saveFeeType(
  ctx: ServiceContext,
  input: { id?: string; name: string; category: FeeCategory; isOptional: boolean },
) {
  requireFees(ctx);
  const data = { name: input.name, category: input.category, isOptional: input.isOptional };
  if (input.id) {
    await found(ctx.db.feeType.findUnique({ where: { id: input.id } }));
    return ctx.db.feeType.update({ where: { id: input.id }, data });
  }
  return ctx.db.feeType.create({ data: { schoolId: ctx.school.id, ...data } });
}

/** Échéances par défaut selon la fréquence, réparties sur l'année scolaire. */
export function defaultInstallments(
  frequency: FeeFrequency,
  start: Date,
  end: Date,
  termNames: { name: string; startDate: Date }[],
): Installment[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (frequency === "ONCE" || frequency === "YEARLY")
    return [{ label: frequency === "ONCE" ? "Unique" : "Annuel", dueDate: iso(start) }];
  if (frequency === "TERMLY")
    return termNames.map((t) => ({ label: t.name, dueDate: iso(new Date(t.startDate.getTime() + 14 * 86_400_000)) }));
  const months: Installment[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 5));
  while (cursor <= end) {
    months.push({
      label: new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(cursor),
      dueDate: iso(cursor),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export async function saveFeeSchedule(
  ctx: ServiceContext,
  input: { id?: string; feeTypeId: string; levelId?: string | null; amount: number; frequency: FeeFrequency },
) {
  requireFees(ctx);
  const year = await requireActiveYear(ctx);
  await found(ctx.db.feeType.findUnique({ where: { id: input.feeTypeId } }));
  if (input.levelId) await found(ctx.db.level.findUnique({ where: { id: input.levelId } }));
  if (input.amount <= 0) throw new DomainError("invalidAmount", "amount");
  const terms = await ctx.db.term.findMany({ where: { academicYearId: year.id }, orderBy: { order: "asc" } });
  const installments = defaultInstallments(input.frequency, year.startDate, year.endDate, terms);
  const data = {
    feeTypeId: input.feeTypeId,
    levelId: input.levelId ?? null,
    amount: input.amount,
    frequency: input.frequency,
    installments: installments as unknown as Prisma.InputJsonValue,
  };
  if (input.id) {
    const existing = await found(ctx.db.feeSchedule.findUnique({ where: { id: input.id } }));
    // Le montant d'une grille déjà facturée change seulement les futures factures.
    await audit(ctx.db, actor(ctx), {
      action: "fee.update",
      entityType: "FeeSchedule",
      entityId: existing.id,
      before: existing,
      after: data,
    });
    return ctx.db.feeSchedule.update({ where: { id: existing.id }, data });
  }
  return ctx.db.feeSchedule.create({ data: { schoolId: ctx.school.id, academicYearId: year.id, ...data } });
}

export async function deleteFeeSchedule(ctx: ServiceContext, id: string) {
  requireFees(ctx);
  const schedule = await found(ctx.db.feeSchedule.findUnique({ where: { id } }));
  const used = await ctx.db.invoice.count({ where: { sourceKey: { startsWith: `${schedule.id}:` }, deletedAt: null } });
  if (used > 0) throw new DomainError("inUse");
  await ctx.db.feeSchedule.delete({ where: { id } });
}

// ── Réductions ─────────────────────────────────────────────────────────────

export async function addDiscount(
  ctx: ServiceContext,
  input: {
    studentId: string;
    kind: DiscountKind;
    label: string;
    percentBp?: number | null;
    amount?: number | null;
    feeTypeId?: string | null;
  },
) {
  requireFees(ctx);
  const year = await requireActiveYear(ctx);
  await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  if (input.feeTypeId) await found(ctx.db.feeType.findUnique({ where: { id: input.feeTypeId } }));
  if (!input.percentBp === !input.amount) throw new DomainError("discountValue", "percent");
  if (input.percentBp && (input.percentBp <= 0 || input.percentBp > 10_000))
    throw new DomainError("discountValue", "percent");
  const discount = await ctx.db.discount.create({
    data: {
      schoolId: ctx.school.id,
      academicYearId: year.id,
      studentId: input.studentId,
      kind: input.kind,
      label: input.label,
      percentBp: input.percentBp ?? null,
      amount: input.amount ?? null,
      feeTypeId: input.feeTypeId ?? null,
    },
  });
  await audit(ctx.db, actor(ctx), {
    action: "discount.create",
    entityType: "Student",
    entityId: input.studentId,
    after: discount,
  });
  return discount;
}

export async function removeDiscount(ctx: ServiceContext, id: string) {
  requireFees(ctx);
  const discount = await found(ctx.db.discount.findUnique({ where: { id } }));
  const used = await ctx.db.invoiceLine.count({ where: { discountId: id } });
  if (used > 0) throw new DomainError("discountUsed");
  await ctx.db.discount.delete({ where: { id } });
  await audit(ctx.db, actor(ctx), {
    action: "discount.delete",
    entityType: "Student",
    entityId: discount.studentId ?? "",
    before: discount,
  });
}

// ── Génération des factures (échéancier) ──────────────────────────────────

/** Ligne de réduction pour un montant de frais ; négative. */
export function discountAmount(discount: { percentBp: number | null; amount: number | null }, base: number) {
  const value = discount.percentBp ? applyBasisPoints(base, discount.percentBp) : (discount.amount ?? 0);
  return -Math.min(value, base);
}

async function nextInvoiceNumber(ctx: ServiceContext, tx: Parameters<typeof nextSequence>[0], yearStart: Date) {
  const y = yearStart.getUTCFullYear();
  const seq = await nextSequence(tx, ctx.school.id, `invoice:${y}`);
  return `FAC-${y}-${String(seq).padStart(5, "0")}`;
}

/**
 * Crée les factures de l'année active à partir des grilles du niveau de
 * chaque élève (frais obligatoires), réductions comprises. Idempotent : une
 * échéance déjà facturée n'est jamais recréée.
 */
export async function generateInvoices(ctx: ServiceContext, input: { classId?: string; studentId?: string }) {
  requireFees(ctx);
  const year = await requireActiveYear(ctx);
  const enrollments = await ctx.db.enrollment.findMany({
    where: {
      academicYearId: year.id,
      status: "ACTIVE",
      deletedAt: null,
      ...(input.classId ? { classId: input.classId } : {}),
      ...(input.studentId ? { studentId: input.studentId } : {}),
    },
    include: { class: true },
  });
  const schedules = await ctx.db.feeSchedule.findMany({
    where: { academicYearId: year.id, feeType: { isOptional: false } },
    include: { feeType: true },
  });
  const discounts = await ctx.db.discount.findMany({
    where: { academicYearId: year.id, studentId: { in: enrollments.map((e) => e.studentId) } },
  });

  let created = 0;
  for (const enrollment of enrollments) {
    const mine = schedules.filter((s) => s.levelId === null || s.levelId === enrollment.class.levelId);
    for (const schedule of mine) {
      created += await invoiceSchedule(
        ctx,
        year,
        enrollment.studentId,
        schedule,
        discounts.filter((d) => d.studentId === enrollment.studentId),
      );
    }
  }
  if (created > 0) {
    await audit(ctx.db, actor(ctx), {
      action: "invoice.generate",
      entityType: "AcademicYear",
      entityId: year.id,
      after: { classId: input.classId ?? null, studentId: input.studentId ?? null, created },
    });
  }
  return { created };
}

type Schedule = Awaited<ReturnType<ServiceContext["db"]["feeSchedule"]["findMany"]>>[number] & {
  feeType: { id: string; name: string };
};

async function invoiceSchedule(
  ctx: ServiceContext,
  year: { id: string; startDate: Date },
  studentId: string,
  schedule: Schedule,
  discounts: { id: string; label: string; feeTypeId: string | null; percentBp: number | null; amount: number | null }[],
) {
  const installments = (schedule.installments as unknown as Installment[] | null) ?? [];
  const applicable = discounts.filter((d) => d.feeTypeId === null || d.feeTypeId === schedule.feeTypeId);
  let created = 0;
  for (const [i, inst] of installments.entries()) {
    const sourceKey = `${schedule.id}:${i}`;
    if (await ctx.db.invoice.findFirst({ where: { studentId, sourceKey } })) continue;
    const lines = [
      {
        label: `${schedule.feeType.name} — ${inst.label}`,
        amount: schedule.amount,
        feeTypeId: schedule.feeTypeId,
        discountId: null as string | null,
      },
      ...applicable.map((d) => ({
        label: d.label,
        amount: discountAmount(d, schedule.amount),
        feeTypeId: null,
        discountId: d.id,
      })),
    ];
    const total = lines.reduce((t, l) => t + l.amount, 0);
    await ctx.db.$transaction(async (tx) => {
      const number = await nextInvoiceNumber(ctx, tx, year.startDate);
      const invoice = await tx.invoice.create({
        data: {
          schoolId: ctx.school.id,
          studentId,
          academicYearId: year.id,
          number,
          label: `${schedule.feeType.name} — ${inst.label}`,
          sourceKey,
          issueDate: new Date(),
          dueDate: new Date(`${inst.dueDate}T00:00:00.000Z`),
          total,
          status: total === 0 ? "PAID" : "UNPAID",
        },
      });
      await tx.invoiceLine.createMany({
        data: lines.map((l) => ({ schoolId: ctx.school.id, invoiceId: invoice.id, ...l })),
      });
    });
    created += 1;
  }
  return created;
}

/** Facture ponctuelle (frais facultatif : cantine, tenue…) pour un élève. */
export async function addOptionalFee(
  ctx: ServiceContext,
  input: { studentId: string; feeTypeId: string; amount: number; label: string; dueDate: Date },
) {
  requireFees(ctx);
  const year = await requireActiveYear(ctx);
  const feeType = await found(ctx.db.feeType.findUnique({ where: { id: input.feeTypeId } }));
  await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  if (input.amount <= 0) throw new DomainError("invalidAmount", "amount");
  return ctx.db.$transaction(async (tx) => {
    const number = await nextInvoiceNumber(ctx, tx, year.startDate);
    const invoice = await tx.invoice.create({
      data: {
        schoolId: ctx.school.id,
        studentId: input.studentId,
        academicYearId: year.id,
        number,
        label: input.label || feeType.name,
        issueDate: new Date(),
        dueDate: input.dueDate,
        total: input.amount,
      },
    });
    await tx.invoiceLine.create({
      data: {
        schoolId: ctx.school.id,
        invoiceId: invoice.id,
        label: input.label || feeType.name,
        amount: input.amount,
        feeTypeId: feeType.id,
      },
    });
    return invoice;
  });
}

/** Annule une facture non payée (erreur de facturation). Tracé. */
export async function cancelInvoice(ctx: ServiceContext, input: { invoiceId: string; reason: string }) {
  if (!canAll(ctx.scope, "payment.cancel")) throw new ForbiddenError();
  const invoice = await found(ctx.db.invoice.findFirst({ where: { id: input.invoiceId, deletedAt: null } }));
  if (invoice.amountPaid > 0) throw new DomainError("invoiceHasPayments");
  await ctx.db.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
  await audit(ctx.db, actor(ctx), {
    action: "invoice.cancel",
    entityType: "Invoice",
    entityId: invoice.id,
    before: { status: invoice.status, total: invoice.total },
    after: { status: "CANCELLED", reason: input.reason },
  });
}
