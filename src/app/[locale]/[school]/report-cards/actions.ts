"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { generateReportCards, publishReportCards } from "@/server/services/report-cards";
import { id } from "@/lib/zod";

export const generateReportCardsAction = schoolAction(
  { permission: "reportcard.publish", schema: z.object({ classId: id, termId: id }) },
  async (ctx, input) => generateReportCards(ctx, input),
);

export const publishReportCardsAction = schoolAction(
  { permission: "reportcard.publish", schema: z.object({ classId: id, termId: id }) },
  async (ctx, input) => publishReportCards(ctx, input),
);
