"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { markNotificationsRead } from "@/server/services/notifications";

export const markAllReadAction = schoolAction({ schema: z.object({}), allowReadOnly: true }, async (ctx) =>
  markNotificationsRead(ctx),
);
