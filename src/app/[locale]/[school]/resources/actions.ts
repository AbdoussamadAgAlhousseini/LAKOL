"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { createResource, deleteResource } from "@/server/services/resources";
import { file, id, optionalId, optionalText, text } from "@/lib/zod";

export const createResourceAction = schoolAction(
  {
    permission: "resource.write",
    schema: z.object({
      subjectId: id,
      levelId: optionalId,
      type: z.enum(["COURSE", "EXERCISE", "CORRECTION", "PAST_EXAM"]),
      title: text(160),
      description: optionalText(1000),
      url: z.string().trim().url().max(500).optional(),
      file: file.optional(),
    }),
  },
  async (ctx, input) => {
    await createResource(ctx, input);
  },
);

export const deleteResourceAction = schoolAction(
  { permission: "resource.write", schema: z.object({ id }) },
  async (ctx, input) => deleteResource(ctx, input.id),
);
