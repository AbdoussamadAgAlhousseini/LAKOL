"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { toggleSchoolModule } from "@/server/services/subscription";
import { MODULE_KEYS } from "@/lib/modules";
import { checkbox } from "@/lib/zod";

export const toggleModuleAction = schoolAction(
  { permission: "school.settings.manage", schema: z.object({ module: z.enum(MODULE_KEYS), enabled: checkbox }) },
  async (ctx, input) => toggleSchoolModule(ctx, input.module, input.enabled),
);
