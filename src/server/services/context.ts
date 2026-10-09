import type { School, User } from "@prisma/client";
import type { TenantDb } from "@/server/db/tenant";
import type { AccessScope } from "@/server/rbac/policies";

/** Ce dont la logique métier a besoin : indépendant de Next.js (testable). */
export interface ServiceContext {
  db: TenantDb;
  school: School;
  user: User;
  scope: AccessScope;
  ip?: string | null;
}

export function actor(ctx: ServiceContext) {
  return { schoolId: ctx.school.id, userId: ctx.user.id, ip: ctx.ip ?? null };
}

export const PAGE_SIZE = 20;

export function paginate(page: number | undefined) {
  const p = Math.max(1, Math.floor(page ?? 1));
  return { skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE, page: p };
}
