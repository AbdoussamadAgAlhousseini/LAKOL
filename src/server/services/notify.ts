import type { NotificationChannel, Prisma, School, User } from "@prisma/client";
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
  /** Objet concerné (annonce, conversation…) : regroupement et statistiques. */
  ref?: { type: string; id: string };
  /** Envoyé même pendant les heures calmes (absence, cours annulé). */
  urgent?: boolean;
}

type ExternalChannel = Exclude<NotificationChannel, "IN_APP">;

/** Heure locale de l'école (0-23). */
function localHour(school: Pick<School, "timezone">, at: Date) {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: school.timezone }).format(
    at,
  );
  return Number(h);
}

/**
 * Délai avant la fin des heures calmes (0 si l'on est dans la journée).
 * Ex. calme de 20 h à 7 h : à 22 h 30 -> envoi à 7 h.
 */
export function quietDelayMs(school: Pick<School, "timezone" | "quietHoursStart" | "quietHoursEnd">, at = new Date()) {
  const { quietHoursStart: start, quietHoursEnd: end } = school;
  if (start === end) return 0;
  const h = localHour(school, at);
  const quiet = start > end ? h >= start || h < end : h >= start && h < end;
  if (!quiet) return 0;
  const hoursToWait = (end - h + 24) % 24;
  return hoursToWait * 3_600_000 - at.getUTCMinutes() * 60_000 - at.getUTCSeconds() * 1000;
}

/** Début du mois en cours (UTC) : période de décompte du quota WhatsApp. */
export function monthStart(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** Messages WhatsApp de l'école ce mois-ci, et quota du plan (ou de la dérogation). */
export async function whatsappUsage(ctx: NotifyContext) {
  const [used, subscription] = await Promise.all([
    ctx.db.notificationDelivery.count({ where: { channel: "WHATSAPP", createdAt: { gte: monthStart() } } }),
    ctx.db.subscription.findFirst({ include: { plan: true } }),
  ]);
  return { used, quota: subscription ? (subscription.whatsappQuota ?? subscription.plan.whatsappQuota) : null };
}

async function whatsappQuotaReached(ctx: NotifyContext) {
  const { used, quota } = await whatsappUsage(ctx);
  return quota !== null && used >= quota;
}

/**
 * Notifie un utilisateur : notification in-app immédiate, puis envoi externe
 * (WhatsApp en priorité, email sinon) mis en file, différé pendant les heures
 * calmes de l'école, et tracé dans NotificationDelivery. `channels: []` =
 * in-app seulement.
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
      refType: message.ref?.type,
      refId: message.ref?.id,
    },
  });
  // Quota WhatsApp du plan atteint : email à la place (ou in-app seul). L'urgent passe toujours.
  const whatsapp =
    channels.includes("WHATSAPP") && Boolean(user.phone) && (message.urgent || !(await whatsappQuotaReached(ctx)));
  const channel: ExternalChannel | null = whatsapp
    ? "WHATSAPP"
    : channels.includes("EMAIL") && user.email
      ? "EMAIL"
      : null;
  if (!channel) return { notificationId: notification.id, channel: null };

  const delayMs = message.urgent ? 0 : quietDelayMs(ctx.school);
  const delivery = await ctx.db.notificationDelivery.create({
    data: {
      schoolId,
      notificationId: notification.id,
      channel,
      recipient: channel === "WHATSAPP" ? user.phone! : user.email!,
      scheduledFor: delayMs ? new Date(Date.now() + delayMs) : null,
    },
  });
  await enqueue("delivery.send", { deliveryId: delivery.id }, { delayMs });
  return { notificationId: notification.id, channel };
}

/** Notifie les tuteurs d'un élève qui acceptent les notifications. Renvoie le nombre de parents prévenus. */
export async function notifyGuardians(
  ctx: NotifyContext,
  studentId: string,
  message: OutgoingMessage,
  channels: ExternalChannel[] = ["WHATSAPP", "EMAIL"],
  /** Filtre supplémentaire sur les tuteurs (ex. { canViewFinance: true }). */
  filter: Prisma.StudentGuardianWhereInput = {},
) {
  const links = await ctx.db.studentGuardian.findMany({
    where: { ...filter, studentId, receivesNotifications: true, guardian: { deletedAt: null, userId: { not: null } } },
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
