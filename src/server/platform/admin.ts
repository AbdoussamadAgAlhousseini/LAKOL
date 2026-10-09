import "server-only";
import type { ModuleKey, PlatformInvoiceStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getCurrentSession } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac/policies";
import { effectiveModules, MODULE_KEYS } from "@/lib/modules";
import { addDays } from "@/lib/time";
import { monthStart } from "@/server/services/notify";
import { limitsOf } from "./subscriptions";

/** Super admin connecté, sinon erreur. */
export async function requirePlatformAdmin() {
  const current = await getCurrentSession();
  if (!current?.user.isPlatformAdmin) throw new ForbiddenError();
  return current.user;
}

async function studentCounts() {
  const counts = await prisma.enrollment.groupBy({
    by: ["schoolId"],
    where: { status: "ACTIVE", deletedAt: null, academicYear: { isActive: true } },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.schoolId, c._count._all]));
}

async function whatsappCounts() {
  const counts = await prisma.notificationDelivery.groupBy({
    by: ["schoolId"],
    where: { channel: "WHATSAPP", createdAt: { gte: monthStart() } },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.schoolId, c._count._all]));
}

/** Tableau de bord de la plateforme : écoles, élèves, revenus, factures, essais. */
export async function platformOverview() {
  await requirePlatformAdmin();
  const now = new Date();
  const [subs, students, whatsapp, issued, paidThisYear] = await Promise.all([
    prisma.subscription.findMany({ where: { school: { deletedAt: null } }, include: { plan: true, school: true } }),
    studentCounts(),
    whatsappCounts(),
    prisma.platformInvoice.findMany({ where: { status: "ISSUED" }, select: { amount: true, dueDate: true } }),
    prisma.platformInvoice.aggregate({
      where: { status: "PAID", paidAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) } },
      _sum: { amount: true },
    }),
  ]);
  const byStatus = {} as Record<SubscriptionStatus, number>;
  let annualRevenue = 0;
  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status === "ACTIVE" || s.status === "PAST_DUE")
      annualRevenue += (students.get(s.schoolId) ?? 0) * limitsOf(s).pricePerStudent;
  }
  return {
    schools: subs.length,
    byStatus,
    students: [...students.values()].reduce((t, n) => t + n, 0),
    whatsappThisMonth: [...whatsapp.values()].reduce((t, n) => t + n, 0),
    annualRevenue,
    outstanding: issued.reduce((t, i) => t + i.amount, 0),
    overdue: issued.filter((i) => i.dueDate < now).reduce((t, i) => t + i.amount, 0),
    collectedThisYear: paidThisYear._sum.amount ?? 0,
    trialsEndingSoon: subs
      .filter((s) => s.status === "TRIAL" && s.trialEndsAt && s.trialEndsAt <= addDays(now, 7))
      .map((s) => ({ id: s.schoolId, name: s.school.name, trialEndsAt: s.trialEndsAt! })),
  };
}

/** Liste des écoles avec formule, statut, effectifs et usage WhatsApp du mois. */
export async function listPlatformSchools(filters: { q?: string; status?: SubscriptionStatus }) {
  await requirePlatformAdmin();
  const schools = await prisma.school.findMany({
    where: {
      deletedAt: null,
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: "insensitive" } },
              { slug: { contains: filters.q, mode: "insensitive" } },
              { city: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filters.status ? { subscription: { status: filters.status } } : {}),
    },
    include: { subscription: { include: { plan: true } } },
    orderBy: { name: "asc" },
  });
  const [students, whatsapp] = await Promise.all([studentCounts(), whatsappCounts()]);
  return schools.map((s) => {
    const limits = s.subscription ? limitsOf(s.subscription) : null;
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      city: s.city,
      isActive: s.isActive,
      plan: s.subscription?.plan.name ?? "—",
      status: s.subscription?.status ?? null,
      trialEndsAt: s.subscription?.trialEndsAt ?? null,
      currentPeriodEnd: s.subscription?.currentPeriodEnd ?? null,
      students: students.get(s.id) ?? 0,
      maxStudents: limits?.maxStudents ?? null,
      whatsapp: whatsapp.get(s.id) ?? 0,
      whatsappQuota: limits?.whatsappQuota ?? null,
    };
  });
}

/** Fiche d'une école pour le super admin. */
export async function platformSchool(id: string) {
  await requirePlatformAdmin();
  const school = await prisma.school.findFirst({
    where: { id, deletedAt: null },
    include: {
      subscription: { include: { plan: true } },
      modules: true,
      platformInvoices: { orderBy: { createdAt: "desc" } },
      userRoles: { where: { role: { key: "DIRECTOR" } }, include: { user: true } },
    },
  });
  if (!school) throw new DomainError("notFound");
  const [students, whatsapp, plans, history] = await Promise.all([
    prisma.enrollment.count({
      where: { schoolId: id, status: "ACTIVE", deletedAt: null, academicYear: { isActive: true } },
    }),
    prisma.notificationDelivery.count({
      where: { schoolId: id, channel: "WHATSAPP", createdAt: { gte: monthStart() } },
    }),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { pricePerStudent: "asc" } }),
    prisma.auditLog.findMany({
      where: { schoolId: id, action: { startsWith: "platform." } },
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  const sub = school.subscription;
  const planModules = sub?.plan.modules ?? [];
  const active = effectiveModules(planModules, school.modules);
  const modules = MODULE_KEYS.map((key: ModuleKey) => {
    const setting = school.modules.find((m) => m.module === key);
    return {
      key,
      inPlan: planModules.includes(key),
      active: active.has(key),
      granted: Boolean(setting?.grantedByPlatform && setting.enabled),
      disabledBySchool: planModules.includes(key) && setting?.enabled === false,
    };
  });
  return {
    school,
    subscription: sub,
    limits: sub ? limitsOf(sub) : null,
    students,
    whatsapp,
    plans,
    modules,
    invoices: school.platformInvoices,
    directors: school.userRoles.map((r) => r.user),
    history,
  };
}

export async function listPlans() {
  await requirePlatformAdmin();
  const plans = await prisma.plan.findMany({
    orderBy: { pricePerStudent: "asc" },
    include: { _count: { select: { subscriptions: true } } },
  });
  return plans;
}

export async function updatePlan(
  id: string,
  input: {
    name: string;
    maxStudents: number | null;
    whatsappQuota: number;
    pricePerStudent: number;
    modules: ModuleKey[];
    isActive: boolean;
  },
) {
  await requirePlatformAdmin();
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) throw new DomainError("notFound");
  return prisma.plan.update({ where: { id }, data: input });
}

export async function listPlatformInvoices(filters: { status?: PlatformInvoiceStatus }) {
  await requirePlatformAdmin();
  return prisma.platformInvoice.findMany({
    where: filters.status ? { status: filters.status } : {},
    include: { school: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
