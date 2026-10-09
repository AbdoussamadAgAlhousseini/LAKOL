import { prisma } from "@/server/db/client";
import { getEmailProvider } from "@/server/adapters/email";
import { getWhatsAppProvider } from "@/server/adapters/whatsapp";
import { runSubscriptionLifecycle } from "@/server/platform/subscriptions";
import { sendHomeworkReminders, sendAllPaymentReminders } from "./reminders";

export interface JobData {
  "delivery.send": { deliveryId: string };
  "homework.reminders": Record<string, never>;
  "finance.reminders": Record<string, never>;
  "deliveries.flush": Record<string, never>;
  "subscriptions.check": Record<string, never>;
}
export type JobName = keyof JobData;

/** Traite une tâche. `final` : dernière tentative (l'échec devient définitif). */
export async function runJob<N extends JobName>(name: N, data: JobData[N], opts: { final: boolean }) {
  switch (name) {
    case "delivery.send":
      return sendDelivery((data as JobData["delivery.send"]).deliveryId, opts.final);
    case "homework.reminders":
      return sendHomeworkReminders();
    case "finance.reminders":
      return sendAllPaymentReminders();
    case "deliveries.flush":
      return flushDeliveries();
    case "subscriptions.check":
      return runSubscriptionLifecycle();
    default:
      throw new Error(`Tâche inconnue : ${String(name)}`);
  }
}

/** Envoie un message WhatsApp ou email préparé et met à jour son suivi. */
export async function sendDelivery(deliveryId: string, final: boolean) {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: { include: { user: { select: { locale: true } } } } },
  });
  if (!delivery || delivery.status === "SENT" || delivery.status === "DELIVERED" || delivery.status === "READ") return;
  const { title, body, link: path } = delivery.notification;
  // Lien complet vers la page concernée (les notifications stockent un chemin relatif).
  const link = path && process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}${path}` : null;
  try {
    const provider = delivery.channel === "WHATSAPP" ? getWhatsAppProvider() : getEmailProvider();
    const result =
      delivery.channel === "WHATSAPP"
        ? await getWhatsAppProvider().sendNotification({
            to: delivery.recipient,
            title,
            body,
            link,
            locale: delivery.notification.user.locale,
          })
        : await getEmailProvider().send({
            to: delivery.recipient,
            subject: title,
            text: link ? `${body}\n\n${link}` : body,
          });
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attempts: { increment: 1 },
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        error: null,
      },
    });
  } catch (error) {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: final ? "FAILED" : "QUEUED", attempts: { increment: 1 }, error: String(error).slice(0, 500) },
    });
    throw error;
  }
}

/**
 * Filet de sécurité : envoie les messages en attente dont l'heure est venue
 * (envois différés sans Redis, tâches perdues). Un message déjà envoyé n'est
 * jamais renvoyé (contrôle du statut dans sendDelivery).
 */
export async function flushDeliveries(now = new Date()) {
  const due = await prisma.notificationDelivery.findMany({
    where: {
      status: "QUEUED",
      OR: [
        { scheduledFor: { lte: now } },
        { scheduledFor: null, createdAt: { lte: new Date(now.getTime() - 5 * 60_000) } },
      ],
    },
    select: { id: true },
    take: 500,
    orderBy: { createdAt: "asc" },
  });
  let sent = 0;
  for (const { id } of due) {
    try {
      await sendDelivery(id, true);
      sent += 1;
    } catch {
      // l'échec est tracé sur la ligne (FAILED)
    }
  }
  return { due: due.length, sent };
}
