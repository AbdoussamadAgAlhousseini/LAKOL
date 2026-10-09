"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import {
  addStop,
  assignStudent,
  deleteRoute,
  deleteStop,
  saveRoute,
  unassignStudent,
} from "@/server/services/modules/transport";
import { parseTime } from "@/lib/time";
import { id, optionalId, optionalInt, optionalText, text } from "@/lib/zod";

const time = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/)
  .optional();
function minutes(value: string | undefined, field: string) {
  if (!value) return null;
  const m = parseTime(value);
  if (m === null) throw new DomainError("invalid", field);
  return m;
}

export const saveRouteAction = schoolAction(
  {
    permission: "transport.manage",
    schema: z.object({
      id: optionalId,
      name: text(80),
      vehicle: optionalText(80),
      capacity: optionalInt(1, 200),
      driverStaffId: optionalId,
    }),
  },
  async (ctx, input) => {
    await saveRoute(ctx, input);
  },
);

export const deleteRouteAction = schoolAction(
  { permission: "transport.manage", schema: z.object({ id }) },
  async (ctx, input) => deleteRoute(ctx, input.id),
);

export const addStopAction = schoolAction(
  {
    permission: "transport.manage",
    schema: z.object({ routeId: id, name: text(80), pickup: time, dropoff: time }),
  },
  async (ctx, input) => {
    await addStop(ctx, {
      routeId: input.routeId,
      name: input.name,
      pickupMin: minutes(input.pickup, "pickup"),
      dropoffMin: minutes(input.dropoff, "dropoff"),
    });
  },
);

export const deleteStopAction = schoolAction(
  { permission: "transport.manage", schema: z.object({ id }) },
  async (ctx, input) => deleteStop(ctx, input.id),
);

export const assignAction = schoolAction(
  { permission: "transport.manage", schema: z.object({ studentId: id, routeId: id, stopId: optionalId }) },
  async (ctx, input) => {
    await assignStudent(ctx, input);
  },
);

export const unassignAction = schoolAction(
  { permission: "transport.manage", schema: z.object({ id }) },
  async (ctx, input) => unassignStudent(ctx, input.id),
);
