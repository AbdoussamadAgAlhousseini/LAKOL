import "server-only";
import { cache } from "react";
import type { School, User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool, type TenantDb } from "@/server/db/tenant";
import { getCurrentSession } from "@/server/auth/session";
import { ROLE_PRIORITY, type SystemRole } from "@/server/rbac/permissions";
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
}

/** Tous les espaces (école × rôle) d'un utilisateur, pour le sélecteur. */
export async function listSpaces(userId: string): Promise<Space[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId, school: { isActive: true, deletedAt: null } },
    include: { role: true, school: true },
  });
  return rows
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

  const school = await prisma.school.findUnique({ where: { slug }, include: { subscription: true } });
  if (!school || school.deletedAt || !school.isActive) throw new SchoolNotFoundError();

  const userRoles = await prisma.userRole.findMany({
    where: { userId: user.id, schoolId: school.id },
    include: { role: { include: { permissions: true } } },
  });
  if (userRoles.length === 0) return null;

  const sorted = [...userRoles].sort((a, b) => rolePriority(a.role.key) - rolePriority(b.role.key));
  const active =
    (session.activeSchoolId === school.id && sorted.find((r) => r.role.key === session.activeRoleKey)) || sorted[0];
  const permissions = new Set(active.role.permissions.map((p) => p.permissionKey));

  const db = forSchool(school.id);
  const { classIds, studentIds, staffId } = await loadScope(db, user.id, active.role.key);

  const { subscription, ...schoolFields } = school;

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
  };
});
