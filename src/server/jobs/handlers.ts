import { prisma } from "@/server/db/client";
import { getEmailProvider } from "@/server/adapters/email";
import { getWhatsAppProvider } from "@/server/adapters/whatsapp";
import { sendHomeworkReminders, sendAllPaymentReminders } from "./reminders";

export interface JobData {
  "delivery.send": { deliveryId: string };
  "homework.reminders": Record<string, never>;
  "finance.reminders": Record<string, never>;
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
    default:
      throw new Error(`Tâche inconnue : ${String(name)}`);
  }
}

/** Envoie un message WhatsApp ou email préparé et met à jour son suivi. */
export async function sendDelivery(deliveryId: string, final: boolean) {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: true },
  });
  if (!delivery || delivery.status === "SENT" || delivery.status === "DELIVERED" || delivery.status === "READ") return;
  const { title, body } = delivery.notification;
  try {
    const provider = delivery.channel === "WHATSAPP" ? getWhatsAppProvider() : getEmailProvider();
    const result =
      delivery.channel === "WHATSAPP"
        ? await getWhatsAppProvider().sendText({ to: delivery.recipient, body: `${title}\n\n${body}` })
        : await getEmailProvider().send({ to: delivery.recipient, subject: title, text: body });
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
