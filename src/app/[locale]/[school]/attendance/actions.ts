"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { reviewJustification, saveRollCall, submitJustification } from "@/server/services/attendance";
import { checkbox, date, file, id, optionalId, optionalText, text } from "@/lib/zod";

const entries = z
  .string()
  .max(200_000)
  .transform((v, c) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      c.addIssue({ code: "custom", message: "invalid" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.object({
          studentId: id,
          status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
          minutesLate: z.number().int().min(0).max(240).nullish(),
          clientId: z.string().max(80).nullish(),
        }),
      )
      .max(200),
  );

/** Appel : les entrées arrivent en JSON (aussi depuis la file hors ligne du téléphone). */
export const saveRollCallAction = schoolAction(
  { permission: "attendance.write", schema: z.object({ classId: id, date, slotId: optionalId, entries }) },
  async (ctx, input) => saveRollCall(ctx, input),
);

export const submitJustificationAction = schoolAction(
  {
    permission: "attendance.justify",
    schema: z.object({ attendanceId: id, reason: text(500), file: file.optional() }),
  },
  async (ctx, input) => submitJustification(ctx, input),
);

export const reviewJustificationAction = schoolAction(
  {
    permission: "attendance.write",
    schema: z.object({ attendanceId: id, accept: checkbox, reason: optionalText(500) }),
  },
  async (ctx, input) => reviewJustification(ctx, input),
);
