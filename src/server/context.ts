import "server-only";
import { cache } from "react";
import type { School, User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool, type TenantDb } from "@/server/db/tenant";
import { getCurrentSession } from "@/server/auth/session";
import { ROLE_PRIORITY, type SystemRole } from "@/server/rbac/permissions";
import type { AccessScope } from "@/server/rbac/policies";

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

/** Périmètre `:own` selon l'espace actif. */
async function loadScope(db: TenantDb, userId: string, roleKey: string) {
  const classIds = new Set<string>();
  const studentIds = new Set<string>();
  let staffId: string | null = null;

  const activeYear = await db.academicYear.findFirst({ where: { isActive: true }, select: { id: true } });

  if (roleKey === "TEACHER" || roleKey === "HEAD_TEACHER") {
    const staff = await db.staff.findFirst({ where: { userId, deletedAt: null }, select: { id: true } });
    if (staff && activeYear) {
      staffId = staff.id;
      const [assignments, headed] = await Promise.all([
        db.teachingAssignment.findMany({
          where: { staffId: staff.id, academicYearId: activeYear.id },
          select: { classId: true },
        }),
        db.class.findMany({ where: { headTeacherId: staff.id, academicYearId: activeYear.id }, select: { id: true } }),
      ]);
      assignments.forEach((a) => classIds.add(a.classId));
      headed.forEach((c) => classIds.add(c.id));
      const enrolled = await db.enrollment.findMany({
        where: { classId: { in: [...classIds] }, status: "ACTIVE", deletedAt: null },
        select: { studentId: true },
      });
      enrolled.forEach((e) => studentIds.add(e.studentId));
    }
  } else if (roleKey === "PARENT") {
    const links = await db.studentGuardian.findMany({
      where: { guardian: { userId, deletedAt: null }, student: { deletedAt: null } },
      select: { studentId: true },
    });
    links.forEach((l) => studentIds.add(l.studentId));
  } else if (roleKey === "STUDENT") {
    const student = await db.student.findFirst({
      where: { userId, accountEnabled: true, deletedAt: null },
      select: { id: true },
    });
    if (student) studentIds.add(student.id);
  } else {
    const staff = await db.staff.findFirst({ where: { userId, deletedAt: null }, select: { id: true } });
    staffId = staff?.id ?? null;
  }

  return { classIds, studentIds, staffId };
}
