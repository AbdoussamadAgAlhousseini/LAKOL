import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/server/db/tenant";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Trace une action sensible : qui, quoi, quand, ancienne et nouvelle valeur. */
export async function audit(
  db: Pick<TenantDb, "auditLog">,
  actor: { schoolId: string; userId: string | null; ip?: string | null },
  entry: AuditEntry,
) {
  await db.auditLog.create({
    data: {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      ip: actor.ip ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
