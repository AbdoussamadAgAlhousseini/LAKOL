import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";

/** Vérifie la signature `X-Hub-Signature-256` envoyée par Meta (HMAC-SHA256 du corps brut). */
export function verifyWhatsAppSignature(
  rawBody: string,
  header: string | null,
  secret = process.env.WHATSAPP_APP_SECRET,
) {
  if (!secret) return process.env.NODE_ENV !== "production"; // en dev sans secret : accepté
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const STATUS: Record<string, DeliveryStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};
const RANK: Record<DeliveryStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

interface WebhookPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: {
          id: string;
          status: string;
          timestamp?: string;
          errors?: { title?: string; message?: string }[];
        }[];
      };
    }[];
  }[];
}

/**
 * Met à jour le suivi des envois à partir des statuts WhatsApp (envoyé, remis, lu, échec).
 * Un statut ne fait jamais reculer un envoi (Meta peut livrer les événements dans le désordre).
 */
export async function applyWhatsAppStatuses(payload: WebhookPayload) {
  let updated = 0;
  for (const entry of payload.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const s of change.value?.statuses ?? []) {
        const status = STATUS[s.status];
        if (!status || !s.id) continue;
        const delivery = await prisma.notificationDelivery.findFirst({ where: { providerMessageId: s.id } });
        if (!delivery || (RANK[status] <= RANK[delivery.status] && status !== "FAILED")) continue;
        const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status,
            ...(status === "DELIVERED" ? { deliveredAt: at } : {}),
            ...(status === "READ" ? { readAt: at, deliveredAt: delivery.deliveredAt ?? at } : {}),
            ...(status === "FAILED"
              ? { error: s.errors?.map((e) => e.message ?? e.title).join("; ") || "Échec WhatsApp" }
              : {}),
          },
        });
        updated++;
      }
  if (updated) logger.info({ channel: "whatsapp", updated }, "statuts WhatsApp reçus");
  return updated;
}
