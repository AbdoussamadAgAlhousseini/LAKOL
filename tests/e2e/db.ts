import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Lecture directe de la base depuis les tests (ex. message WhatsApp simulé).
export const db = new PrismaClient();

/** Dernier message envoyé à ce numéro (mot de passe provisoire, etc.). */
export async function lastMessageTo(phone: string) {
  const delivery = await db.notificationDelivery.findFirst({
    where: { recipient: phone },
    include: { notification: true },
    orderBy: { createdAt: "desc" },
  });
  return delivery?.notification.body ?? null;
}
