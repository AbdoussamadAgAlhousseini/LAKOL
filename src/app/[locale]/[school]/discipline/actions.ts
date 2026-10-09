"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { createIncident, deleteIncident } from "@/server/services/discipline";
import { date, id, optionalText, text } from "@/lib/zod";

export const createIncidentAction = schoolAction(
  {
    permission: "discipline.write",
    schema: z.object({
      studentId: id,
      type: z.enum(["INCIDENT", "WARNING", "SANCTION", "SUMMONS"]),
      date,
      description: text(2000),
      sanction: optionalText(500),
    }),
  },
  async (ctx, input) => {
    await createIncident(ctx, input);
  },
);

export const deleteIncidentAction = schoolAction(
  { permission: "discipline.write", schema: z.object({ id }) },
  async (ctx, i) => deleteIncident(ctx, i.id),
);
