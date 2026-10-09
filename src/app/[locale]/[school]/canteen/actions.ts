"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { saveMenu, subscribeCanteen, unsubscribeCanteen } from "@/server/services/modules/canteen";
import { date, id, optionalText, text } from "@/lib/zod";

export const subscribeAction = schoolAction(
  { permission: "canteen.manage", schema: z.object({ studentId: id, dietNotes: optionalText(200) }) },
  async (ctx, input) => {
    await subscribeCanteen(ctx, input);
  },
);

export const unsubscribeAction = schoolAction(
  { permission: "canteen.manage", schema: z.object({ id }) },
  async (ctx, input) => unsubscribeCanteen(ctx, input.id),
);

export const saveMenuAction = schoolAction(
  { permission: "canteen.manage", schema: z.object({ date, meal: text(200), notes: optionalText(200) }) },
  async (ctx, input) => {
    await saveMenu(ctx, input);
  },
);
