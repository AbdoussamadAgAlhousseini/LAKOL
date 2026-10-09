import "server-only";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "../context";
import { found } from "../structure";

function requireManager(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "inventory.manage")) throw new ForbiddenError();
}

/** Articles en stock ; ceux sous le seuil d'alerte d'abord. */
export async function listItems(ctx: ServiceContext) {
  requireManager(ctx);
  const items = await ctx.db.inventoryItem.findMany({
    where: { deletedAt: null },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { name: "asc" },
  });
  return items.sort((a, b) => Number(b.quantity <= b.minQuantity) - Number(a.quantity <= a.minQuantity));
}

export async function saveItem(
  ctx: ServiceContext,
  input: {
    id?: string;
    name: string;
    category?: string | null;
    unit: string;
    minQuantity: number;
    location?: string | null;
  },
) {
  requireManager(ctx);
  const data = {
    name: input.name,
    category: input.category ?? null,
    unit: input.unit,
    minQuantity: input.minQuantity,
    location: input.location ?? null,
  };
  if (input.id) {
    await found(ctx.db.inventoryItem.findFirst({ where: { id: input.id, deletedAt: null } }));
    return ctx.db.inventoryItem.update({ where: { id: input.id }, data });
  }
  return ctx.db.inventoryItem.create({ data: { schoolId: ctx.school.id, ...data } });
}

/** Entrée (+) ou sortie (−) de stock, tracée ; le stock ne devient jamais négatif. */
export async function moveStock(ctx: ServiceContext, input: { itemId: string; delta: number; reason: string }) {
  requireManager(ctx);
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new DomainError("invalid", "delta");
  return ctx.db.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, deletedAt: null } });
    if (!item) throw new DomainError("notFound");
    // Mise à jour conditionnelle : deux sorties simultanées ne peuvent pas passer sous zéro.
    const res = await tx.inventoryItem.updateMany({
      where: { id: item.id, quantity: { gte: Math.max(0, -input.delta) } },
      data: { quantity: { increment: input.delta } },
    });
    if (res.count === 0) throw new DomainError("insufficientStock", "delta");
    await tx.stockMovement.create({
      data: {
        schoolId: ctx.school.id,
        itemId: item.id,
        delta: input.delta,
        reason: input.reason,
        recordedById: ctx.user.id,
      },
    });
  });
}

/** Articles à réapprovisionner (tableau de bord). */
export async function lowStockCount(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "inventory.manage")) return 0;
  const items = await ctx.db.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { quantity: true, minQuantity: true },
  });
  return items.filter((i) => i.quantity <= i.minQuantity).length;
}
