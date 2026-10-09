"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { acknowledgeAnnouncement, createAnnouncement, remindUnacknowledged } from "@/server/services/announcements";
import { retryFailedDeliveries } from "@/server/services/notifications";
import { checkbox, id, text } from "@/lib/zod";

export const createAnnouncementAction = schoolAction(
  {
    permission: "announcement.publish",
    schema: z.object({
      title: text(160),
      body: text(5000),
      audience: z.enum(["SCHOOL", "PARENTS", "STAFF", "LEVEL", "CLASS"]),
      levelIds: z.array(id).max(50).default([]),
      classIds: z.array(id).max(100).default([]),
      requiresAck: checkbox,
      channels: z
        .array(z.enum(["WHATSAPP", "EMAIL"]))
        .max(2)
        .default([]),
    }),
  },
  async (ctx, { levelIds, classIds, ...input }) => {
    const targetIds = input.audience === "LEVEL" ? levelIds : input.audience === "CLASS" ? classIds : [];
    const announcement = await createAnnouncement(ctx, { ...input, targetIds });
    return { id: announcement.id };
  },
);

// Tout destinataire (parent, élève, personnel) : le service vérifie qu'il a reçu l'annonce.
export const acknowledgeAction = schoolAction({ schema: z.object({ id }) }, async (ctx, input) =>
  acknowledgeAnnouncement(ctx, input.id),
);

export const remindAction = schoolAction(
  { permission: "announcement.publish", schema: z.object({ id }) },
  async (ctx, input) => remindUnacknowledged(ctx, input.id),
);

export const retryDeliveriesAction = schoolAction(
  { permission: "announcement.publish", schema: z.object({}) },
  async (ctx) => retryFailedDeliveries(ctx),
);
