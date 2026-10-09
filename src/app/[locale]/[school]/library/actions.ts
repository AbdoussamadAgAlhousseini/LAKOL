"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { lendBook, returnBook, saveBook } from "@/server/services/modules/library";
import { id, int, optionalId, optionalInt, optionalText, text } from "@/lib/zod";

export const saveBookAction = schoolAction(
  {
    permission: "library.manage",
    schema: z.object({
      id: optionalId,
      title: text(200),
      author: optionalText(120),
      isbn: optionalText(20),
      category: optionalText(60),
      copies: int(1, 1000),
      location: optionalText(60),
    }),
  },
  async (ctx, input) => {
    await saveBook(ctx, input);
  },
);

export const lendAction = schoolAction(
  {
    permission: "library.manage",
    schema: z.object({ bookId: id, studentId: optionalId, staffId: optionalId, days: optionalInt(1, 90) }),
  },
  async (ctx, input) => {
    await lendBook(ctx, input);
  },
);

export const returnAction = schoolAction(
  { permission: "library.manage", schema: z.object({ id }) },
  async (ctx, input) => returnBook(ctx, input.id),
);
