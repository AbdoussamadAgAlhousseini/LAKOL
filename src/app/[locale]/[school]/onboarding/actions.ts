"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { phoneOrFail } from "@/server/phone-field";
import { applyMaliTemplate, finishOnboarding, startSchoolYear, updateSchoolBasics } from "@/server/services/onboarding";
import { date, email, optionalText, text } from "@/lib/zod";

export const schoolBasicsAction = schoolAction(
  {
    permission: "school.settings.manage",
    schema: z.object({
      name: text(160),
      city: text(80),
      phone: text(30),
      address: optionalText(200),
      email: email.optional(),
    }),
  },
  async (ctx, input) =>
    updateSchoolBasics(ctx, { ...input, phone: phoneOrFail(input.phone, ctx.school.country, "phone") }),
);

export const startYearAction = schoolAction(
  { permission: "school.structure.manage", schema: z.object({ name: text(40), startDate: date, endDate: date }) },
  async (ctx, input) => {
    await startSchoolYear(ctx, input);
  },
);

export const applyTemplateAction = schoolAction(
  {
    permission: "school.structure.manage",
    schema: z.object({
      cycles: z.array(z.enum(["MATERNELLE", "FONDAMENTAL_1", "FONDAMENTAL_2", "LYCEE"])).default([]),
    }),
  },
  async (ctx, input) => applyMaliTemplate(ctx, input),
);

export const finishOnboardingAction = schoolAction(
  { permission: "school.settings.manage", schema: z.object({}) },
  async (ctx) => finishOnboarding(ctx),
);
