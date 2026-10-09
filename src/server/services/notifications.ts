import "server-only";
import { enqueue } from "@/server/jobs/queue";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { paginate, type ServiceContext } from "./context";

export async function listNotifications(ctx: ServiceContext, filters: { page?: number }) {
  const { skip, take, page } = paginate(filters.page);
  const where = { userId: ctx.user.id };
  const [items, total, unread] = await Promise.all([
    ctx.db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    ctx.db.notification.count({ where }),
    ctx.db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items, total, page, unread };
}

export async function unreadNotificationCount(ctx: ServiceContext) {
  return ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } });
}

export async function markNotificationsRead(ctx: ServiceContext, ids?: string[]) {
  await ctx.db.notification.updateMany({
    where: { userId: ctx.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

/** Suivi des envois WhatsApp / email (administration). */
export async function listDeliveries(
  ctx: ServiceContext,
  filters: { status?: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED"; page?: number },
) {
  if (!canAll(ctx.scope, "announcement.publish")) throw new ForbiddenError();
  const { skip, take, page } = paginate(filters.page);
  const where = filters.status ? { status: filters.status } : {};
  const [items, total, groups] = await Promise.all([
    ctx.db.notificationDelivery.findMany({
      where,
      include: { notification: { select: { title: true, type: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    ctx.db.notificationDelivery.count({ where }),
    ctx.db.notificationDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    items,
    total,
    page,
    counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>,
  };
}

/** Relance l'envoi des messages en échec. */
export async function retryFailedDeliveries(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "announcement.publish")) throw new ForbiddenError();
  const failed = await ctx.db.notificationDelivery.findMany({
    where: { status: "FAILED" },
    select: { id: true },
    take: 200,
  });
  await ctx.db.notificationDelivery.updateMany({
    where: { id: { in: failed.map((f) => f.id) } },
    data: { status: "QUEUED", error: null },
  });
  for (const f of failed) await enqueue("delivery.send", { deliveryId: f.id });
  return { retried: failed.length };
}
