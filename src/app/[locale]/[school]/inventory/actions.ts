"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { moveStock, saveItem } from "@/server/services/modules/inventory";
import { id, int, optionalId, optionalText, text } from "@/lib/zod";

export const saveItemAction = schoolAction(
  {
    permission: "inventory.manage",
    schema: z.object({
      id: optionalId,
      name: text(120),
      category: optionalText(60),
      unit: text(20),
      minQuantity: int(0, 1_000_000),
      location: optionalText(60),
    }),
  },
  async (ctx, input) => {
    await saveItem(ctx, input);
  },
);

export const moveStockAction = schoolAction(
  {
    permission: "inventory.manage",
    schema: z.object({
      itemId: id,
      direction: z.enum(["IN", "OUT"]),
      quantity: int(1, 1_000_000),
      reason: text(200),
    }),
  },
  async (ctx, input) =>
    moveStock(ctx, {
      itemId: input.itemId,
      delta: input.direction === "IN" ? input.quantity : -input.quantity,
      reason: input.reason,
    }),
);
