// Abonnements des écoles : limites du plan, cycle de vie (essai, actif,
// impayé, suspendu), factures de la plateforme et modules.
// Pas de "server-only" : la tâche quotidienne du worker l'utilise.
import type { ModuleKey, PaymentMethod, Plan, Prisma, Subscription } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool } from "@/server/db/tenant";
import { DomainError } from "@/server/errors";
import { audit, type AuditEntry } from "@/server/audit";
import { notifyUser, type OutgoingMessage } from "@/server/services/notify";
import { formatMoney } from "@/lib/money";
import { addDays } from "@/lib/time";

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 15;
export const INVOICE_DUE_DAYS = 15;
/** Une facture de renouvellement est émise ce nombre de jours avant la fin de période. */
export const RENEWAL_NOTICE_DAYS = 30;
export const FREE_PLAN = "FREE";

type SubscriptionWithPlan = Subscription & { plan: Plan };

/** Limites effectives : dérogations de l'abonnement, sinon celles du plan. */
export function limitsOf(sub: SubscriptionWithPlan) {
  return {
    maxStudents: sub.maxStudents ?? sub.plan.maxStudents,
    whatsappQuota: sub.whatsappQuota ?? sub.plan.whatsappQuota,
    pricePerStudent: sub.pricePerStudent ?? sub.plan.pricePerStudent,
  };
}

/** Élèves inscrits (actifs) dans l'année en cours : base des limites et de la facturation. */
export async function activeStudentCount(schoolId: string) {
  return prisma.enrollment.count({
    where: { schoolId, status: "ACTIVE", deletedAt: null, academicYear: { isActive: true } },
  });
}

/** Refuse une inscription qui dépasserait le nombre d'élèves autorisé par le plan. */
export async function assertStudentCapacity(schoolId: string, adding = 1) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId }, include: { plan: true } });
  if (!sub) return;
  const { maxStudents } = limitsOf(sub);
  if (maxStudents === null) return;
  if ((await activeStudentCount(schoolId)) + adding > maxStudents) throw new DomainError("studentLimit");
}

/** Journal d'audit de l'école concernée par une action de la plateforme. */
function platformAudit(schoolId: string, actorId: string | null, entry: AuditEntry) {
  return audit(forSchool(schoolId), { schoolId, userId: actorId, ip: null }, entry);
}

// ── Notifications à la direction ───────────────────────────────────────────

async function notifyDirectors(schoolId: string, message: OutgoingMessage) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  const directors = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { schoolId, role: { key: "DIRECTOR" } } } },
  });
  const ctx = { db: forSchool(schoolId), school };
  for (const d of directors) await notifyUser(ctx, d, { ...message, link: `/${school.slug}/subscription` });
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

// ── Factures de la plateforme ──────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/** Numéro LAK-AAAA-NNNNN, sans trou ni doublon (verrou de transaction). */
async function nextInvoiceNumber(tx: Tx, year: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_invoice_number'))`;
  const prefix = `LAK-${year}-`;
  const last = await tx.platformInvoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const next = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

/**
 * Émet la facture annuelle d'une école : élèves inscrits × prix par élève
 * (au moins 1 élève facturé). La période suit la précédente si elle existe.
 */
export async function issueInvoice(
  schoolId: string,
  input: { periodStart?: Date; studentCount?: number; notes?: string | null } = {},
  actorId: string | null = null,
) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId }, include: { plan: true } });
  if (!sub) throw new DomainError("noSubscription");
  const { pricePerStudent } = limitsOf(sub);
  if (pricePerStudent <= 0) throw new DomainError("freePlan");
  const open = await prisma.platformInvoice.findFirst({ where: { schoolId, status: "ISSUED" } });
  if (open) throw new DomainError("invoiceAlreadyOpen");

  const periodStart =
    input.periodStart ??
    (sub.currentPeriodEnd && sub.status !== "TRIAL" ? addDays(sub.currentPeriodEnd, 1) : startOfDay(new Date()));
  const periodEnd = addDays(addYears(periodStart, 1), -1);
  const studentCount = Math.max(1, input.studentCount ?? (await activeStudentCount(schoolId)));
  const amount = studentCount * pricePerStudent;

  const invoice = await prisma.$transaction(async (tx) => {
    const number = await nextInvoiceNumber(tx, new Date().getUTCFullYear());
    return tx.platformInvoice.create({
      data: {
        number,
        schoolId,
        subscriptionId: sub.id,
        planName: sub.plan.name,
        periodStart,
        periodEnd,
        studentCount,
        pricePerStudent,
        amount,
        currency: sub.plan.currency,
        dueDate: addDays(startOfDay(new Date()), INVOICE_DUE_DAYS),
        notes: input.notes ?? null,
        createdById: actorId,
      },
    });
  });
  await platformAudit(schoolId, actorId, {
    action: "platform.invoice.issue",
    entityType: "PlatformInvoice",
    entityId: invoice.id,
    after: { number: invoice.number, amount, studentCount },
  });
  await notifyDirectors(schoolId, {
    type: "subscription.invoice",
    title: `Facture LAKOL ${invoice.number}`,
    body: `Votre facture d'abonnement (${sub.plan.name}, ${studentCount} élève${studentCount > 1 ? "s" : ""}) de ${formatMoney(amount, invoice.currency)} est disponible. À régler avant le ${fmtDate(invoice.dueDate)}.`,
  });
  return invoice;
}

/** Enregistre le règlement d'une facture : l'abonnement redevient actif pour la période facturée. */
export async function recordInvoicePayment(
  invoiceId: string,
  input: { method: PaymentMethod; reference?: string | null; paidAt?: Date },
  actorId: string | null,
) {
  const invoice = await prisma.platformInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new DomainError("notFound");
  if (invoice.status !== "ISSUED") throw new DomainError("invoiceNotOpen");
  const paidAt = input.paidAt ?? new Date();
  await prisma.$transaction([
    prisma.platformInvoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt, paymentMethod: input.method, paymentRef: input.reference ?? null },
    }),
    prisma.subscription.update({
      where: { id: invoice.subscriptionId },
      data: {
        status: "ACTIVE",
        currentPeriodStart: invoice.periodStart,
        currentPeriodEnd: invoice.periodEnd,
        trialEndsAt: null,
        graceEndsAt: null,
        suspendedAt: null,
        cancelledAt: null,
      },
    }),
  ]);
  await platformAudit(invoice.schoolId, actorId, {
    action: "platform.invoice.paid",
    entityType: "PlatformInvoice",
    entityId: invoice.id,
    after: { number: invoice.number, amount: invoice.amount, method: input.method, reference: input.reference },
  });
  await notifyDirectors(invoice.schoolId, {
    type: "subscription.paid",
    title: "Paiement reçu — merci",
    body: `Le règlement de la facture ${invoice.number} est enregistré. Votre abonnement est actif jusqu'au ${fmtDate(invoice.periodEnd)}.`,
  });
}

export async function voidInvoice(invoiceId: string, reason: string, actorId: string | null) {
  const invoice = await prisma.platformInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new DomainError("notFound");
  if (invoice.status !== "ISSUED") throw new DomainError("invoiceNotOpen");
  await prisma.platformInvoice.update({ where: { id: invoice.id }, data: { status: "VOID", notes: reason } });
  await platformAudit(invoice.schoolId, actorId, {
    action: "platform.invoice.void",
    entityType: "PlatformInvoice",
    entityId: invoice.id,
    after: { reason },
  });
}

// ── Gestion par le super admin ─────────────────────────────────────────────

/** Change la formule. Les réglages d'école sur des modules hors de la nouvelle formule sont effacés. */
export async function changePlan(schoolId: string, planId: string, actorId: string | null) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId }, include: { plan: true } });
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!sub || !plan || !plan.isActive) throw new DomainError("notFound");
  await prisma.$transaction([
    prisma.subscription.update({ where: { id: sub.id }, data: { planId } }),
    prisma.moduleActivation.deleteMany({
      where: { schoolId, grantedByPlatform: false, module: { notIn: plan.modules } },
    }),
  ]);
  await platformAudit(schoolId, actorId, {
    action: "platform.plan",
    entityType: "Subscription",
    entityId: sub.id,
    before: { plan: sub.plan.code },
    after: { plan: plan.code },
  });
}

export async function updateSubscriptionTerms(
  schoolId: string,
  input: { maxStudents: number | null; pricePerStudent: number | null; whatsappQuota: number | null },
  actorId: string | null,
) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId } });
  if (!sub) throw new DomainError("noSubscription");
  await prisma.subscription.update({ where: { id: sub.id }, data: input });
  await platformAudit(schoolId, actorId, {
    action: "platform.terms",
    entityType: "Subscription",
    entityId: sub.id,
    before: { maxStudents: sub.maxStudents, pricePerStudent: sub.pricePerStudent, whatsappQuota: sub.whatsappQuota },
    after: input,
  });
}

export async function extendTrial(schoolId: string, days: number, actorId: string | null) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId } });
  if (!sub) throw new DomainError("noSubscription");
  const from = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
  const trialEndsAt = addDays(from, days);
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "TRIAL", trialEndsAt, graceEndsAt: null, suspendedAt: null, lastNoticeKey: null },
  });
  await platformAudit(schoolId, actorId, {
    action: "platform.trial",
    entityType: "Subscription",
    entityId: sub.id,
    after: { trialEndsAt },
  });
}

/** Suspension (lecture seule, aucune donnée supprimée) ou réactivation manuelle. */
export async function setSuspended(schoolId: string, suspended: boolean, actorId: string | null) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId } });
  if (!sub) throw new DomainError("noSubscription");
  await prisma.subscription.update({
    where: { id: sub.id },
    data: suspended
      ? { status: "SUSPENDED", suspendedAt: new Date() }
      : { status: "ACTIVE", suspendedAt: null, graceEndsAt: null },
  });
  await platformAudit(schoolId, actorId, {
    action: suspended ? "platform.suspend" : "platform.reactivate",
    entityType: "Subscription",
    entityId: sub.id,
    before: { status: sub.status },
  });
  await notifyDirectors(schoolId, {
    type: suspended ? "subscription.suspended" : "subscription.reactivated",
    title: suspended ? "Compte LAKOL en lecture seule" : "Compte LAKOL réactivé",
    body: suspended
      ? "Votre abonnement est suspendu : les données restent consultables mais ne peuvent plus être modifiées. Contactez LAKOL pour régulariser."
      : "Votre abonnement est de nouveau actif. Merci !",
    urgent: true,
  });
}

/**
 * Active ou désactive un module. La plateforme peut accorder un module hors
 * formule ; l'école ne peut agir que sur les modules de sa formule.
 */
export async function setModule(
  schoolId: string,
  module: ModuleKey,
  enabled: boolean,
  by: { platform: boolean; actorId: string | null },
) {
  const sub = await prisma.subscription.findUnique({ where: { schoolId }, include: { plan: true } });
  const inPlan = Boolean(sub?.plan.modules.includes(module));
  if (!by.platform && !inPlan) throw new DomainError("moduleNotInPlan");
  await prisma.moduleActivation.upsert({
    where: { schoolId_module: { schoolId, module } },
    create: { schoolId, module, enabled, grantedByPlatform: by.platform && !inPlan && enabled },
    update: { enabled, grantedByPlatform: by.platform && !inPlan && enabled },
  });
  await platformAudit(schoolId, by.actorId, {
    action: enabled ? "module.enable" : "module.disable",
    entityType: "ModuleActivation",
    entityId: module,
    after: { module, enabled, byPlatform: by.platform },
  });
}

// ── Cycle de vie (tâche quotidienne) ───────────────────────────────────────

/** Envoie un avis à la direction une seule fois par clé (ex. « trial-7 »). */
async function noticeOnce(sub: Subscription, key: string, message: OutgoingMessage) {
  if (sub.lastNoticeKey === key) return;
  await prisma.subscription.update({ where: { id: sub.id }, data: { lastNoticeKey: key } });
  await notifyDirectors(sub.schoolId, message);
}

/**
 * Transitions automatiques :
 * - essai : rappel 7 jours avant la fin ; à la fin, passage à la formule gratuite (données conservées) ;
 * - actif payant : facture de renouvellement 30 jours avant l'échéance ; à l'échéance, impayé avec délai de grâce ;
 * - impayé : à la fin du délai de grâce, suspension (lecture seule).
 */
export async function runSubscriptionLifecycle(now = new Date()) {
  const result = { trialReminders: 0, trialsEnded: 0, renewals: 0, pastDue: 0, suspended: 0 };
  const free = await prisma.plan.findUnique({ where: { code: FREE_PLAN } });
  const subs = await prisma.subscription.findMany({
    where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] }, school: { deletedAt: null, isActive: true } },
    include: { plan: true },
  });
  for (const sub of subs) {
    const price = limitsOf(sub).pricePerStudent;
    if (sub.status === "TRIAL" && sub.trialEndsAt) {
      if (sub.trialEndsAt <= now) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: "ACTIVE",
            trialEndsAt: null,
            currentPeriodStart: now,
            currentPeriodEnd: null,
            ...(free ? { planId: free.id } : {}),
          },
        });
        if (free) {
          await prisma.moduleActivation.deleteMany({
            where: { schoolId: sub.schoolId, grantedByPlatform: false, module: { notIn: free.modules } },
          });
        }
        await noticeOnce(sub, "trial-ended", {
          type: "subscription.trial_ended",
          title: "Fin de la période d'essai",
          body: `Votre essai de LAKOL est terminé : l'école passe à la formule gratuite. Toutes vos données sont conservées ; contactez-nous pour retrouver tous les modules.`,
        });
        result.trialsEnded++;
      } else if (sub.trialEndsAt <= addDays(now, 7)) {
        await noticeOnce(sub, "trial-7", {
          type: "subscription.trial_ending",
          title: "Votre essai se termine bientôt",
          body: `Votre essai de LAKOL se termine le ${fmtDate(sub.trialEndsAt)}. Contactez-nous pour choisir votre formule et garder tous les modules.`,
        });
        result.trialReminders++;
      }
      continue;
    }
    if (sub.status === "ACTIVE" && price > 0 && sub.currentPeriodEnd) {
      if (sub.currentPeriodEnd <= now) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "PAST_DUE", graceEndsAt: addDays(now, GRACE_DAYS) },
        });
        await ensureRenewalInvoice(sub.schoolId);
        await noticeOnce(sub, `past-due-${isoDay(sub.currentPeriodEnd)}`, {
          type: "subscription.past_due",
          title: "Abonnement à renouveler",
          body: `Votre abonnement LAKOL est arrivé à échéance. Merci de régler la facture avant le ${fmtDate(addDays(now, GRACE_DAYS))} pour éviter le passage en lecture seule.`,
        });
        result.pastDue++;
      } else if (sub.currentPeriodEnd <= addDays(now, RENEWAL_NOTICE_DAYS)) {
        if (await ensureRenewalInvoice(sub.schoolId)) result.renewals++;
      }
      continue;
    }
    if (sub.status === "PAST_DUE" && sub.graceEndsAt && sub.graceEndsAt <= now) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "SUSPENDED", suspendedAt: now } });
      await noticeOnce(sub, `suspended-${isoDay(sub.graceEndsAt)}`, {
        type: "subscription.suspended",
        title: "Compte LAKOL en lecture seule",
        body: "Faute de règlement, votre compte est passé en lecture seule. Aucune donnée n'est perdue : dès le paiement enregistré, tout redevient normal.",
        urgent: true,
      });
      result.suspended++;
    }
  }
  return result;
}

/** Émet la facture de renouvellement si aucune n'est en attente. Renvoie true si une facture a été créée. */
async function ensureRenewalInvoice(schoolId: string) {
  const open = await prisma.platformInvoice.findFirst({ where: { schoolId, status: "ISSUED" } });
  if (open) return false;
  await issueInvoice(schoolId);
  return true;
}

// ── Utilitaires de dates (UTC) ─────────────────────────────────────────────

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addYears(d: Date, years: number) {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}
