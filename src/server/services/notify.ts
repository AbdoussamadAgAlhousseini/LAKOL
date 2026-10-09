import type { NotificationChannel, School, User } from "@prisma/client";
import type { TenantDb } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";

/** Le minimum pour notifier : l'école et son client de base (utilisable hors requête). */
export interface NotifyContext {
  db: TenantDb;
  school: School;
}

export interface OutgoingMessage {
  type: string; // ex. "attendance.absent"
  title: string;
  body: string;
  link?: string;
}

type ExternalChannel = Exclude<NotificationChannel, "IN_APP">;

/**
 * Notifie un utilisateur : notification in-app immédiate, puis envoi externe
 * (WhatsApp en priorité, email sinon) mis en file et tracé dans
 * NotificationDelivery. `channels: []` = in-app seulement.
 */
export async function notifyUser(
  ctx: NotifyContext,
  user: Pick<User, "id" | "phone" | "email">,
  message: OutgoingMessage,
  channels: ExternalChannel[] = ["WHATSAPP", "EMAIL"],
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
  const channel: ExternalChannel | null =
    channels.includes("WHATSAPP") && user.phone
      ? "WHATSAPP"
      : channels.includes("EMAIL") && user.email
        ? "EMAIL"
        : null;
  if (!channel) return { notificationId: notification.id, channel: null };

  const delivery = await ctx.db.notificationDelivery.create({
    data: {
      schoolId,
      notificationId: notification.id,
      channel,
      recipient: channel === "WHATSAPP" ? user.phone! : user.email!,
    },
  });
  await enqueue("delivery.send", { deliveryId: delivery.id });
  return { notificationId: notification.id, channel };
}

/** Notifie les tuteurs d'un élève qui acceptent les notifications. Renvoie le nombre de parents prévenus. */
export async function notifyGuardians(
  ctx: NotifyContext,
  studentId: string,
  message: OutgoingMessage,
  channels: ExternalChannel[] = ["WHATSAPP", "EMAIL"],
) {
  const links = await ctx.db.studentGuardian.findMany({
    where: { studentId, receivesNotifications: true, guardian: { deletedAt: null, userId: { not: null } } },
    include: { guardian: { include: { user: true } } },
  });
  let count = 0;
  for (const link of links) {
    const user = link.guardian.user;
    if (!user || !user.isActive) continue;
    await notifyUser(ctx, user, message, channels);
    count += 1;
  }
  return count;
}
