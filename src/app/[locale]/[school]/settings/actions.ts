"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { uploadLogo, updateSchoolSettings } from "@/server/services/settings";
import { checkbox, color, email, file, optionalText, text } from "@/lib/zod";

export const updateSettingsAction = schoolAction(
  {
    permission: "school.settings.manage",
    schema: z.object({
      name: text(160),
      shortName: optionalText(60),
      city: optionalText(80),
      address: optionalText(200),
      phone: optionalText(30),
      email: email.optional(),
      defaultLocale: z.enum(["fr", "en"]),
      currency: z.enum(["XOF", "XAF", "GNF", "EUR", "USD"]),
      gradingScale: z.coerce.number().pipe(z.union([z.literal(10), z.literal(20)])),
      termKind: z.enum(["TRIMESTER", "SEMESTER"]),
      primaryColor: color,
      secondaryColor: color,
      reportCardHeader: optionalText(500),
      blockReportIfUnpaid: checkbox,
    }),
  },
  async (ctx, input) => {
    await updateSchoolSettings(ctx, input);
  },
);

export const uploadLogoAction = schoolAction(
  { permission: "school.settings.manage", schema: z.object({ file }) },
  async (ctx, { file: upload }) => uploadLogo(ctx, upload),
);
