import "server-only";
import type { NotificationChannel, User } from "@prisma/client";
import { getEmailProvider } from "@/server/adapters/email";
import { getWhatsAppProvider } from "@/server/adapters/whatsapp";
import { logger } from "@/server/logger";
import type { ServiceContext } from "./context";

export interface OutgoingMessage {
  type: string; // ex. "account.created"
  title: string;
  body: string;
  link?: string;
}

/**
 * Notifie un utilisateur : notification in-app + envois externes tracés
 * (NotificationDelivery). Un échec d'envoi n'interrompt pas l'opération.
 * Envoi synchrone pour l'instant ; passera par la file de tâches (phase 3).
 */
export async function notifyUser(
  ctx: ServiceContext,
  user: Pick<User, "id" | "phone" | "email">,
  message: OutgoingMessage,
  channels: Exclude<NotificationChannel, "IN_APP">[] = ["WHATSAPP", "EMAIL"],
) {
  const schoolId = ctx.school.id;
  const notification = await ctx.db.notification.create({
    data: {
      schoolId,
      userId: user.id,
      type: message.type,
      title: message.title,
      body: message.body,
      link: message.link,
    },
  });

  // WhatsApp en priorité ; l'email seulement si pas de téléphone.
  const channel =
    channels.includes("WHATSAPP") && user.phone
      ? "WHATSAPP"
      : channels.includes("EMAIL") && user.email
        ? "EMAIL"
        : null;
  if (!channel) return { notificationId: notification.id, channel: null };

  const recipient = channel === "WHATSAPP" ? user.phone! : user.email!;
  const delivery = await ctx.db.notificationDelivery.create({
    data: { schoolId, notificationId: notification.id, channel, recipient },
  });
  try {
    const text = `${message.title}\n\n${message.body}`;
    const result =
      channel === "WHATSAPP"
        ? await getWhatsAppProvider().sendText({ to: recipient, body: text })
        : await getEmailProvider().send({ to: recipient, subject: message.title, text: message.body });
    await ctx.db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attempts: 1,
        providerMessageId: result.providerMessageId,
        provider: channel === "WHATSAPP" ? getWhatsAppProvider().name : getEmailProvider().name,
      },
    });
  } catch (error) {
    logger.error({ channel, error: String(error) }, "échec d'envoi");
    await ctx.db.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", attempts: 1, error: String(error).slice(0, 500) },
    });
  }
  return { notificationId: notification.id, channel };
}
