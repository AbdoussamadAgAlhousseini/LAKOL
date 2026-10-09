"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { recordVisit } from "@/server/services/modules/infirmary";
import { id, optionalText, text } from "@/lib/zod";

export const recordVisitAction = schoolAction(
  {
    permission: "infirmary.manage",
    schema: z.object({
      studentId: id,
      reason: text(200),
      care: optionalText(500),
      outcome: z.enum(["RETURNED_TO_CLASS", "RESTED", "SENT_HOME", "REFERRED"]),
    }),
  },
  async (ctx, input) => {
    await recordVisit(ctx, input);
  },
);
