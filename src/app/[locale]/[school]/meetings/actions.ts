"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import { bookSlot, cancelBooking, cancelSlot, createSlots } from "@/server/services/meetings";
import { parseTime } from "@/lib/time";
import { date, id, int, optionalText } from "@/lib/zod";

export const createSlotsAction = schoolAction(
  {
    permission: "meeting.manage",
    schema: z.object({
      date,
      start: z.string().regex(/^\d{1,2}:\d{2}$/),
      count: int(1, 20),
      durationMin: int(5, 120),
      location: optionalText(120),
    }),
  },
  async (ctx, { start, ...input }) => {
    const startMin = parseTime(start);
    if (startMin === null) throw new DomainError("invalid", "start");
    return createSlots(ctx, { ...input, startMin });
  },
);

export const cancelSlotAction = schoolAction(
  { permission: "meeting.manage", schema: z.object({ id }) },
  async (ctx, input) => cancelSlot(ctx, input.id),
);

export const bookSlotAction = schoolAction(
  { permission: "meeting.book", schema: z.object({ slotId: id, studentId: id, note: optionalText(300) }) },
  async (ctx, input) => bookSlot(ctx, input),
);

export const cancelBookingAction = schoolAction(
  { permission: "meeting.book", schema: z.object({ id }) },
  async (ctx, input) => cancelBooking(ctx, input.id),
);
