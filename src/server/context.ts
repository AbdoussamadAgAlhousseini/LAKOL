import "server-only";
import { cache } from "react";
import type { School, User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool, type TenantDb } from "@/server/db/tenant";
import { getCurrentSession } from "@/server/auth/session";
import type { ModuleKey, SubscriptionStatus } from "@prisma/client";
import { permissionsForModules, ROLE_PRIORITY, type SystemRole } from "@/server/rbac/permissions";
import { effectiveModules } from "@/lib/modules";
import type { AccessScope } from "@/server/rbac/policies";
import { loadScope } from "@/server/scope";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Non connecté");
    this.name = "UnauthenticatedError";
  }
}

export class SchoolNotFoundError extends Error {
  constructor() {
    super("École introuvable");
    this.name = "SchoolNotFoundError";
  }
}

export interface Space {
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  roleKey: string;
  roleName: string;
}

export interface SchoolContext {
  user: User;
  sessionId: string;
  school: School;
  db: TenantDb;
  /** Rôles de l'utilisateur dans cette école. */
  roles: { key: string; name: string }[];
  /** Rôle (espace) actif : détermine les permissions et la navigation. */
  activeRole: string;
  scope: AccessScope;
  staffId: string | null;
  /** Abonnement suspendu : lecture seule, aucune perte de données. */
  readOnly: boolean;
  /** Modules actifs (plan, réglages de l'école, ajouts de la plateforme). */
  modules: Set<ModuleKey>;
  subscription: SubscriptionSummary | null;
}

export interface SubscriptionSummary {
  status: SubscriptionStatus;
  planCode: string;
  planName: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
}

/** Tous les espaces (école × rôle) d'un utilisateur, pour le sélecteur. */
export async function listSpaces(userId: string): Promise<Space[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId, school: { isActive: true, deletedAt: null } },
    include: { role: true, school: true },
  });
  // « Professeur principal » inclut tous les droits de « Professeur » : un seul espace suffit.
  const headIn = new Set(rows.filter((r) => r.role.key === "HEAD_TEACHER").map((r) => r.schoolId));
  return rows
    .filter((r) => !(r.role.key === "TEACHER" && headIn.has(r.schoolId)))
    .map((r) => ({
      schoolId: r.schoolId,
      schoolSlug: r.school.slug,
      schoolName: r.school.name,
      roleKey: r.role.key,
      roleName: r.role.name,
    }))
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName) || rolePriority(a.roleKey) - rolePriority(b.roleKey));
}

function rolePriority(key: string): number {
  const i = ROLE_PRIORITY.indexOf(key as SystemRole);
  return i === -1 ? ROLE_PRIORITY.length : i;
}

/**
 * Charge le contexte d'une école pour l'utilisateur connecté.
 * Lève UnauthenticatedError, SchoolNotFoundError ou renvoie null si
 * l'utilisateur n'a aucun rôle dans cette école.
 */
export const getSchoolContext = cache(async (slug: string): Promise<SchoolContext | null> => {
  const current = await getCurrentSession();
  if (!current) throw new UnauthenticatedError();
  const { session, user } = current;

  const school = await prisma.school.findUnique({
    where: { slug },
    include: { subscription: { include: { plan: true } }, modules: true },
  });
  if (!school || school.deletedAt || !school.isActive) throw new SchoolNotFoundError();

  const userRoles = await prisma.userRole.findMany({
    where: { userId: user.id, schoolId: school.id },
    include: { role: { include: { permissions: true } } },
  });
  if (userRoles.length === 0) return null;

  const sorted = [...userRoles].sort((a, b) => rolePriority(a.role.key) - rolePriority(b.role.key));
  const active =
    (session.activeSchoolId === school.id && sorted.find((r) => r.role.key === session.activeRoleKey)) || sorted[0];
  const { subscription, modules: moduleSettings, ...schoolFields } = school;
  const modules = effectiveModules(subscription?.plan.modules ?? [], moduleSettings);
  // Un module inactif retire ses permissions : navigation, pages, actions et services suivent.
  const permissions = permissionsForModules(
    active.role.permissions.map((p) => p.permissionKey),
    modules,
  );

  const db = forSchool(school.id);
  const { classIds, studentIds, staffId } = await loadScope(db, user.id, active.role.key);

  return {
    user,
    sessionId: session.id,
    school: schoolFields,
    db,
    roles: sorted.map((r) => ({ key: r.role.key, name: r.role.name })),
    activeRole: active.role.key,
    scope: { permissions, classIds, studentIds },
    staffId,
    readOnly: subscription?.status === "SUSPENDED" || subscription?.status === "CANCELLED",
    modules,
    subscription: subscription
      ? {
          status: subscription.status,
          planCode: subscription.plan.code,
          planName: subscription.plan.name,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          graceEndsAt: subscription.graceEndsAt,
        }
      : null,
  };
});
