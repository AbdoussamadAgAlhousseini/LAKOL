import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { nextSequence } from "@/server/db/sequence";
import { DomainError } from "@/server/errors";
import { getPaymentProvider } from "@/server/adapters/payment";
import { canAll, ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import { formatMoney } from "@/lib/money";
import { actor, paginate, type ServiceContext } from "../context";
import { notifyGuardians } from "../notify";
import { found, requireActiveYear } from "../structure";

type Tx = Parameters<Parameters<ServiceContext["db"]["$transaction"]>[0]>[0];

function invoiceStatus(total: number, paid: number) {
  return paid <= 0 ? "UNPAID" : paid < total ? "PARTIAL" : "PAID";
}

/**
 * Enregistre un paiement fait à l'école et le répartit sur les factures :
 * d'abord celle choisie, puis les plus anciennes échéances. Un reçu numéroté
 * (sans trou) est créé dans la même transaction. Un trop-perçu est refusé.
 */
export async function recordPayment(
  ctx: ServiceContext,
  input: {
    studentId: string;
    amount: number;
    method: PaymentMethod;
    reference?: string | null;
    paidAt?: Date;
    invoiceId?: string | null;
    guardianId?: string | null;
  },
) {
  if (!canAll(ctx.scope, "payment.write")) throw new ForbiddenError();
  const provider = getPaymentProvider("manual");
  if (!provider.methods.includes(input.method)) throw new DomainError("methodUnavailable", "method");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("invalidAmount", "amount");
  if ((input.method === "CHEQUE" || input.method === "TRANSFER") && !input.reference)
    throw new DomainError("referenceRequired", "reference");
  const student = await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  if (input.guardianId) await found(ctx.db.guardian.findUnique({ where: { id: input.guardianId } }));

  const open = await ctx.db.invoice.findMany({
    where: { studentId: student.id, status: { in: ["UNPAID", "PARTIAL"] }, deletedAt: null },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  if (input.invoiceId) {
    const chosen = open.findIndex((i) => i.id === input.invoiceId);
    if (chosen === -1) throw new DomainError("invoiceNotOpen", "invoiceId");
    open.unshift(...open.splice(chosen, 1));
  }
  const outstanding = open.reduce((t, i) => t + i.total - i.amountPaid, 0);
  if (input.amount > outstanding) throw new DomainError("overpayment", "amount");

  const paidAt = input.paidAt ?? new Date();
  const result = await ctx.db.$transaction(async (tx: Tx) => {
    const payment = await tx.payment.create({
      data: {
        schoolId: ctx.school.id,
        studentId: student.id,
        guardianId: input.guardianId ?? null,
        amount: input.amount,
        method: input.method,
        reference: input.reference ?? null,
        provider: provider.name,
        paidAt,
        receivedById: ctx.user.id,
      },
    });
    let remaining = input.amount;
    for (const invoice of open) {
      if (remaining === 0) break;
      const share = Math.min(remaining, invoice.total - invoice.amountPaid);
      if (share <= 0) continue;
      await tx.paymentAllocation.create({
        data: { schoolId: ctx.school.id, paymentId: payment.id, invoiceId: invoice.id, amount: share },
      });
      const paid = invoice.amountPaid + share;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: paid, status: invoiceStatus(invoice.total, paid) },
      });
      remaining -= share;
    }
    const year = paidAt.getUTCFullYear();
    const seq = await nextSequence(tx, ctx.school.id, `receipt:${year}`);
    const receipt = await tx.receipt.create({
      data: { schoolId: ctx.school.id, paymentId: payment.id, number: `REC-${year}-${String(seq).padStart(5, "0")}` },
    });
    return { payment, receipt };
  });

  await notifyGuardians(
    ctx,
    student.id,
    {
      type: "finance.payment",
      title: `Paiement reçu — ${student.firstName}`,
      body: `Nous avons bien reçu ${formatMoney(input.amount, ctx.school.currency)} (reçu ${result.receipt.number}). Merci.`,
      link: `/${ctx.school.slug}/finance`,
    },
    [],
    { canViewFinance: true },
  );
  return result;
}

/** Annule un paiement (erreur de saisie) : factures rouvertes, reçu marqué annulé. Tracé. */
export async function cancelPayment(ctx: ServiceContext, input: { paymentId: string; reason: string }) {
  if (!canAll(ctx.scope, "payment.cancel")) throw new ForbiddenError();
  const payment = await found(
    ctx.db.payment.findFirst({
      where: { id: input.paymentId, deletedAt: null },
      include: { allocations: { include: { invoice: true } }, receipt: true },
    }),
  );
  if (payment.status === "CANCELLED") throw new DomainError("alreadyCancelled");
  await ctx.db.$transaction(async (tx: Tx) => {
    for (const a of payment.allocations) {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const paid = invoice.amountPaid - a.amount;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: paid,
          status: invoice.status === "CANCELLED" ? "CANCELLED" : invoiceStatus(invoice.total, paid),
        },
      });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "CANCELLED", cancelledReason: input.reason },
    });
  });
  await audit(ctx.db, actor(ctx), {
    action: "payment.cancel",
    entityType: "Payment",
    entityId: payment.id,
    before: { amount: payment.amount, method: payment.method, receipt: payment.receipt?.number },
    after: { status: "CANCELLED", reason: input.reason },
  });
}

// ── Compte de l'élève ──────────────────────────────────────────────────────

/** Factures, paiements, réductions et soldes d'un élève (année active). */
export async function studentAccount(ctx: ServiceContext, studentId: string) {
  requireStudentAccess(ctx.scope, "finance.read", studentId);
  const link = await ctx.db.studentGuardian.findFirst({ where: { studentId, guardian: { userId: ctx.user.id } } });
  if (link && !link.canViewFinance) throw new ForbiddenError();
  const year = await requireActiveYear(ctx);
  const [student, invoices, payments, discounts] = await Promise.all([
    found(
      ctx.db.student.findFirst({
        where: { id: studentId, deletedAt: null },
        include: {
          enrollments: { where: { academicYearId: year.id }, include: { class: true } },
          guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } },
        },
      }),
    ),
    ctx.db.invoice.findMany({
      where: { studentId, academicYearId: year.id, deletedAt: null },
      include: { lines: true },
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
    }),
    ctx.db.payment.findMany({
      where: { studentId, deletedAt: null, paidAt: { gte: year.startDate } },
      include: { receipt: true, allocations: { include: { invoice: { select: { label: true } } } } },
      orderBy: { paidAt: "desc" },
    }),
    ctx.db.discount.findMany({ where: { studentId, academicYearId: year.id }, include: { feeType: true } }),
  ]);
  const now = new Date();
  const active = invoices.filter((i) => i.status !== "CANCELLED");
  const total = active.reduce((t, i) => t + i.total, 0);
  const paid = active.reduce((t, i) => t + i.amountPaid, 0);
  const overdue = active.filter((i) => i.dueDate <= now).reduce((t, i) => t + i.total - i.amountPaid, 0);
  return { student, invoices, payments, discounts, total, paid, balance: total - paid, overdue, year };
}

/** Données d'un reçu (accès : finances de l'école, ou famille autorisée). */
export async function receiptData(ctx: ServiceContext, paymentId: string) {
  const payment = await found(
    ctx.db.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: {
        receipt: true,
        student: {
          include: {
            enrollments: { include: { class: true, academicYear: true }, orderBy: { enrolledAt: "desc" }, take: 1 },
          },
        },
        guardian: true,
        allocations: { include: { invoice: true } },
      },
    }),
  );
  requireStudentAccess(ctx.scope, "finance.read", payment.studentId);
  const link = await ctx.db.studentGuardian.findFirst({
    where: { studentId: payment.studentId, guardian: { userId: ctx.user.id } },
  });
  if (link && !link.canViewFinance) throw new ForbiddenError();
  const cashier = await ctx.db.user.findUnique({
    where: { id: payment.receivedById },
    select: { firstName: true, lastName: true },
  });
  const balance = await ctx.db.invoice.aggregate({
    where: { studentId: payment.studentId, status: { in: ["UNPAID", "PARTIAL"] }, deletedAt: null },
    _sum: { total: true, amountPaid: true },
  });
  return { payment, cashier, balanceAfter: (balance._sum.total ?? 0) - (balance._sum.amountPaid ?? 0) };
}

/** Journal des paiements sur une période. */
export async function listPayments(ctx: ServiceContext, filters: { from: Date; to: Date; page?: number }) {
  if (!canAll(ctx.scope, "finance.read")) throw new ForbiddenError();
  const { skip, take, page } = paginate(filters.page);
  const where: Prisma.PaymentWhereInput = { deletedAt: null, paidAt: { gte: filters.from, lt: filters.to } };
  const [items, total, sums] = await Promise.all([
    ctx.db.payment.findMany({
      where,
      include: { student: true, receipt: true },
      orderBy: { paidAt: "desc" },
      skip,
      take,
    }),
    ctx.db.payment.count({ where }),
    ctx.db.payment.aggregate({ where: { ...where, status: "COMPLETED" }, _sum: { amount: true } }),
  ]);
  return { items, total, page, sum: sums._sum.amount ?? 0 };
}

/** Reçu PDF d'un paiement (généré à la demande, « ANNULÉ » si annulé). */
export async function receiptPdf(ctx: ServiceContext, paymentId: string) {
  const { renderReceipt } = await import("@/server/pdf/receipt");
  const { payment, cashier, balanceAfter } = await receiptData(ctx, paymentId);
  if (!payment.receipt) throw new DomainError("notFound");
  const enrollment = payment.student.enrollments[0];
  const payer = payment.guardian
    ? `${payment.guardian.firstName} ${payment.guardian.lastName}`
    : `Parent de ${payment.student.firstName} ${payment.student.lastName}`;
  return {
    number: payment.receipt.number,
    pdf: await renderReceipt({
      school: {
        name: ctx.school.name,
        address: ctx.school.address,
        phone: ctx.school.phone,
        color: ctx.school.primaryColor,
        currency: ctx.school.currency,
        logo: null,
      },
      number: payment.receipt.number,
      date: new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(
        payment.paidAt,
      ),
      cancelled: payment.status === "CANCELLED",
      student: {
        name: `${payment.student.lastName} ${payment.student.firstName}`,
        matricule: payment.student.matricule,
        className: enrollment?.class.name ?? null,
      },
      payer,
      method: payment.method,
      reference: payment.reference,
      amount: payment.amount,
      lines: payment.allocations.map((a) => ({ label: `${a.invoice.label} (${a.invoice.number})`, amount: a.amount })),
      balanceAfter,
      cashier: cashier ? `${cashier.firstName} ${cashier.lastName}` : "",
    }),
  };
}
