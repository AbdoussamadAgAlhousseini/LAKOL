"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import { addSlot, deleteSlot, removeException, setException } from "@/server/services/timetable";
import { parseTime } from "@/lib/time";
import { date, id, int, optionalId, optionalText } from "@/lib/zod";

const time = (field: string) =>
  z.string().transform((v, c) => {
    const m = parseTime(v);
    if (m === null) {
      c.addIssue({ code: "custom", path: [field], message: "invalid" });
      return z.NEVER;
    }
    return m;
  });

export const addSlotAction = schoolAction(
  {
    permission: "timetable.write",
    schema: z.object({
      classId: id,
      subjectId: id,
      roomId: optionalId,
      dayOfWeek: int(1, 7),
      start: time("start"),
      end: time("end"),
    }),
  },
  async (ctx, { start, end, ...input }) => {
    await addSlot(ctx, { ...input, startMin: start, endMin: end });
  },
);

export const deleteSlotAction = schoolAction(
  { permission: "timetable.write", schema: z.object({ id }) },
  async (ctx, i) => deleteSlot(ctx, i.id),
);

export const setExceptionAction = schoolAction(
  {
    permission: "timetable.write",
    schema: z.object({
      slotId: id,
      date,
      kind: z.enum(["CANCELLED", "REPLACED"]),
      replacementStaffId: optionalId,
      note: optionalText(200),
    }),
  },
  async (ctx, input) => {
    if (input.kind === "REPLACED" && !input.replacementStaffId)
      throw new DomainError("replacementRequired", "replacementStaffId");
    await setException(ctx, input);
  },
);

export const removeExceptionAction = schoolAction(
  { permission: "timetable.write", schema: z.object({ id }) },
  async (ctx, i) => removeException(ctx, i.id),
);
