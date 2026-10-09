import "server-only";
import type { ContractType, Gender, Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac/policies";
import { actor, paginate, type ServiceContext } from "./context";
import { ensureUser, grantRole, resetToTemporaryPassword, revokeRole, sendAccess } from "./accounts";
import { found } from "./structure";
import { assertAccountOwnedBySchool } from "./students";

/** Rôles attribuables au personnel (professeur principal, parent et élève sont automatiques). */
export const STAFF_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "CENSOR",
  "ACCOUNTANT",
  "TEACHER",
  "LIBRARIAN",
  "NURSE",
  "DRIVER",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Donner des accès exige « user.manage » ; toucher au rôle de direction exige
 * en plus « role.manage » (évite qu'un secrétariat s'attribue la direction).
 */
function assertCanAssign(ctx: ServiceContext, changed: string[]) {
  if (changed.length === 0) return;
  if (!ctx.scope.permissions.has("user.manage")) throw new ForbiddenError();
  if (changed.includes("DIRECTOR") && !ctx.scope.permissions.has("role.manage")) throw new ForbiddenError();
}

export interface StaffInput {
  firstName: string;
  lastName: string;
  gender?: Gender | null;
  phone?: string | null;
  email?: string | null;
  position: string;
  contractType: ContractType;
  hireDate?: Date | null;
  monthlySalary?: number | null;
  hourlyRate?: number | null;
  diplomas?: string | null; // une ligne par diplôme
}

function staffData(input: StaffInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    position: input.position,
    contractType: input.contractType,
    hireDate: input.hireDate ?? null,
    monthlySalary: input.contractType === "PERMANENT" ? (input.monthlySalary ?? null) : null,
    hourlyRate: input.contractType === "HOURLY" ? (input.hourlyRate ?? null) : null,
    diplomas: (input.diplomas ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((title) => ({ title })),
  };
}

export async function listStaff(ctx: ServiceContext, filters: { q?: string; page?: number; inactive?: boolean }) {
  const { skip, take, page } = paginate(filters.page);
  const q = filters.q?.trim();
  const where: Prisma.StaffWhereInput = {
    deletedAt: null,
    isActive: !filters.inactive,
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { position: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.staff.findMany({
      where,
      include: {
        user: { include: { roles: { where: { schoolId: ctx.school.id }, include: { role: true } } } },
        teachingAssignments: { include: { subject: true }, distinct: ["subjectId"] },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip,
      take,
    }),
    ctx.db.staff.count({ where }),
  ]);
  return { items, total, page };
}

export async function getStaff(ctx: ServiceContext, id: string) {
  return found(
    ctx.db.staff.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: { include: { roles: { where: { schoolId: ctx.school.id }, include: { role: true } } } },
        teachingAssignments: { include: { subject: true, class: true }, orderBy: { class: { name: "asc" } } },
        headOfClasses: { include: { academicYear: true } },
      },
    }),
  );
}

export async function createStaff(
  ctx: ServiceContext,
  input: StaffInput & { roles: StaffRole[]; sendAccess?: boolean },
) {
  assertCanAssign(ctx, input.roles);
  if (input.roles.length > 0 && !input.phone && !input.email) throw new DomainError("contactRequired", "phone");
  let userId: string | null = null;
  let access: { user: Awaited<ReturnType<typeof ensureUser>>["user"]; tempPassword: string | null } | null = null;
  if (input.roles.length > 0) {
    const { user, tempPassword } = await ensureUser(ctx, input);
    if (await ctx.db.staff.findFirst({ where: { userId: user.id, deletedAt: null } })) {
      throw new DomainError("staffExists", "phone");
    }
    userId = user.id;
    access = { user, tempPassword };
  }
  const staff = await ctx.db.staff.create({ data: { schoolId: ctx.school.id, userId, ...staffData(input) } });
  if (userId) {
    for (const role of input.roles) await grantRole(ctx, userId, role);
  }
  if (access && (input.sendAccess ?? true)) await sendAccess(ctx, access.user, "staff", access.tempPassword);
  await audit(ctx.db, actor(ctx), {
    action: "staff.create",
    entityType: "Staff",
    entityId: staff.id,
    after: { position: staff.position, roles: input.roles },
  });
  return staff;
}

export async function updateStaff(ctx: ServiceContext, id: string, input: StaffInput) {
  const before = await found(ctx.db.staff.findFirst({ where: { id, deletedAt: null } }));
  const data = staffData(input);
  await ctx.db.staff.update({ where: { id }, data });
  const changedPay = before.monthlySalary !== data.monthlySalary || before.hourlyRate !== data.hourlyRate;
  if (changedPay) {
    await audit(ctx.db, actor(ctx), {
      action: "staff.pay",
      entityType: "Staff",
      entityId: id,
      before: { monthlySalary: before.monthlySalary, hourlyRate: before.hourlyRate },
      after: { monthlySalary: data.monthlySalary, hourlyRate: data.hourlyRate },
    });
  }
}

/** Remplace les rôles « personnel » d'un membre (crée son compte si besoin). */
export async function setStaffRoles(ctx: ServiceContext, input: { staffId: string; roles: StaffRole[] }) {
  const staff = await found(ctx.db.staff.findFirst({ where: { id: input.staffId, deletedAt: null } }));
  if (staff.userId === ctx.user.id && !input.roles.includes("DIRECTOR")) {
    const isDirector = await ctx.db.userRole.findFirst({ where: { userId: ctx.user.id, role: { key: "DIRECTOR" } } });
    if (isDirector) throw new DomainError("cannotRemoveOwnDirector");
  }

  const current = staff.userId
    ? (await ctx.db.userRole.findMany({ where: { userId: staff.userId }, include: { role: true } })).map(
        (r) => r.role.key,
      )
    : [];
  const changed = STAFF_ROLES.filter((r) => input.roles.includes(r) !== current.includes(r));
  assertCanAssign(ctx, changed);

  let userId = staff.userId;
  if (!userId && input.roles.length > 0) {
    if (!staff.phone && !staff.email) throw new DomainError("contactRequired");
    const { user, tempPassword } = await ensureUser(ctx, staff);
    userId = user.id;
    await ctx.db.staff.update({ where: { id: staff.id }, data: { userId } });
    await sendAccess(ctx, user, "staff", tempPassword);
  }
  if (!userId) return;
  for (const role of STAFF_ROLES) {
    if (input.roles.includes(role)) await grantRole(ctx, userId, role);
    else await revokeRole(ctx, userId, role);
  }
}

/** Départ d'un membre : fiche conservée (historique), accès personnel retirés. */
export async function deactivateStaff(ctx: ServiceContext, id: string) {
  const staff = await found(ctx.db.staff.findFirst({ where: { id, deletedAt: null } }));
  if (staff.userId === ctx.user.id) throw new DomainError("cannotDeactivateSelf");
  await ctx.db.staff.update({ where: { id }, data: { isActive: false } });
  if (staff.userId) {
    for (const role of [...STAFF_ROLES, "HEAD_TEACHER"]) await revokeRole(ctx, staff.userId, role);
  }
  await audit(ctx.db, actor(ctx), { action: "staff.deactivate", entityType: "Staff", entityId: id });
}

export async function reactivateStaff(ctx: ServiceContext, id: string) {
  await found(ctx.db.staff.findFirst({ where: { id, deletedAt: null } }));
  await ctx.db.staff.update({ where: { id }, data: { isActive: true } });
  await audit(ctx.db, actor(ctx), { action: "staff.reactivate", entityType: "Staff", entityId: id });
}

export async function resendStaffAccess(ctx: ServiceContext, staffId: string) {
  const staff = await found(
    ctx.db.staff.findFirst({ where: { id: staffId, deletedAt: null }, include: { user: true } }),
  );
  if (!staff.user) throw new DomainError("noAccount");
  await assertAccountOwnedBySchool(ctx, staff.user.id);
  const tempPassword = await resetToTemporaryPassword(ctx, staff.user.id);
  await sendAccess(ctx, staff.user, "staff", tempPassword);
  await audit(ctx.db, actor(ctx), { action: "account.reset", entityType: "User", entityId: staff.user.id });
}
