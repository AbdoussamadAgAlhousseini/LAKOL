import "server-only";
import type { AudienceKind, NotificationChannel } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { actor, paginate, type ServiceContext } from "./context";
import { notifyUser } from "./notify";
import { found, getActiveYear } from "./structure";

type Recipient = { id: string; phone: string | null; email: string | null };

/**
 * Destinataires d'une annonce :
 * - SCHOOL : parents, personnel et élèves ayant un compte ;
 * - PARENTS / STAFF : tous les parents / tout le personnel ;
 * - LEVEL / CLASS : parents, élèves (avec compte) et professeurs des classes visées.
 */
export async function resolveAudience(ctx: ServiceContext, audience: AudienceKind, targetIds: string[]) {
  const year = await getActiveYear(ctx);
  const users = new Map<string, Recipient>();
  const add = (u: Recipient | null | undefined) => u && users.set(u.id, { id: u.id, phone: u.phone, email: u.email });

  const parentsOf = async (classFilter: object) => {
    const links = await ctx.db.studentGuardian.findMany({
      where: {
        guardian: { deletedAt: null, user: { isActive: true } },
        student: {
          deletedAt: null,
          enrollments: { some: { academicYearId: year?.id ?? "", status: "ACTIVE", deletedAt: null, ...classFilter } },
        },
      },
      include: { guardian: { include: { user: true } } },
    });
    links.forEach((l) => add(l.guardian.user));
  };
  const studentsOf = async (classFilter: object) => {
    const students = await ctx.db.student.findMany({
      where: {
        accountEnabled: true,
        deletedAt: null,
        enrollments: { some: { academicYearId: year?.id ?? "", status: "ACTIVE", ...classFilter } },
      },
      include: { user: true },
    });
    students.forEach((s) => add(s.user));
  };
  const staffOf = async (classFilter?: object) => {
    const staff = await ctx.db.staff.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        user: { isActive: true },
        ...(classFilter
          ? {
              OR: [
                { teachingAssignments: { some: classFilter } },
                { headOfClasses: { some: (classFilter as { class: object }).class } },
              ],
            }
          : {}),
      },
      include: { user: true },
    });
    staff.forEach((s) => add(s.user));
  };

  switch (audience) {
    case "SCHOOL":
      await parentsOf({});
      await studentsOf({});
      await staffOf();
      break;
    case "PARENTS":
      await parentsOf({});
      break;
    case "STAFF":
      await staffOf();
      break;
    case "LEVEL":
    case "CLASS": {
      if (targetIds.length === 0) throw new DomainError("targetsRequired", "targetIds");
      const classWhere =
        audience === "LEVEL"
          ? { levelId: { in: targetIds }, academicYearId: year?.id ?? "" }
          : { id: { in: targetIds } };
      await parentsOf({ class: classWhere });
      await studentsOf({ class: classWhere });
      await staffOf({ class: classWhere });
      break;
    }
    case "CUSTOM":
      throw new DomainError("invalid", "audience");
  }
  users.delete(ctx.user.id);
  return [...users.values()];
}

/** Rédige (et publie) une annonce ; publication = notification de chaque destinataire. */
export async function createAnnouncement(
  ctx: ServiceContext,
  input: {
    title: string;
    body: string;
    audience: AudienceKind;
    targetIds: string[];
    requiresAck: boolean;
    channels: Exclude<NotificationChannel, "IN_APP">[];
  },
) {
  if (!canAll(ctx.scope, "announcement.publish")) throw new ForbiddenError();
  const recipients = await resolveAudience(ctx, input.audience, input.targetIds);
  if (recipients.length === 0) throw new DomainError("noRecipient", "audience");
  const announcement = await ctx.db.announcement.create({
    data: {
      schoolId: ctx.school.id,
      authorId: ctx.user.id,
      title: input.title,
      body: input.body,
      audience: input.audience,
      targetIds: input.targetIds,
      requiresAck: input.requiresAck,
      channels: ["IN_APP", ...input.channels],
      publishedAt: new Date(),
      recipientCount: recipients.length,
    },
  });
  for (const r of recipients) {
    await notifyUser(
      ctx,
      r,
      {
        type: "announcement",
        title: input.title,
        body: input.body.slice(0, 600),
        link: `/${ctx.school.slug}/announcements/${announcement.id}`,
        ref: { type: "Announcement", id: announcement.id },
      },
      input.channels,
    );
  }
  await audit(ctx.db, actor(ctx), {
    action: "announcement.publish",
    entityType: "Announcement",
    entityId: announcement.id,
    after: { audience: input.audience, recipients: recipients.length, requiresAck: input.requiresAck },
  });
  return announcement;
}

/** Annonces reçues par l'utilisateur (et accusé de lecture), ou toutes pour l'équipe de direction. */
export async function listAnnouncements(ctx: ServiceContext, filters: { page?: number }) {
  const { skip, take, page } = paginate(filters.page);
  const publisher = canAll(ctx.scope, "announcement.publish");
  const where = publisher
    ? { publishedAt: { not: null } }
    : {
        publishedAt: { not: null },
        id: {
          in: (
            await ctx.db.notification.findMany({
              where: { userId: ctx.user.id, refType: "Announcement" },
              select: { refId: true },
            })
          ).map((n) => n.refId!),
        },
      };
  const [items, total] = await Promise.all([
    ctx.db.announcement.findMany({
      where,
      include: { acks: { where: { userId: ctx.user.id } }, _count: { select: { acks: true } } },
      orderBy: { publishedAt: "desc" },
      skip,
      take,
    }),
    ctx.db.announcement.count({ where }),
  ]);
  return { items, total, page, publisher };
}

async function isRecipient(ctx: ServiceContext, announcementId: string) {
  return Boolean(
    await ctx.db.notification.findFirst({
      where: { userId: ctx.user.id, refType: "Announcement", refId: announcementId },
    }),
  );
}

export async function getAnnouncement(ctx: ServiceContext, id: string) {
  const announcement = await found(ctx.db.announcement.findFirst({ where: { id, publishedAt: { not: null } } }));
  const publisher = canAll(ctx.scope, "announcement.publish");
  if (!publisher && !(await isRecipient(ctx, id))) throw new ForbiddenError();
  await ctx.db.notification.updateMany({
    where: { userId: ctx.user.id, refType: "Announcement", refId: id, readAt: null },
    data: { readAt: new Date() },
  });
  const author = await ctx.db.user.findUnique({
    where: { id: announcement.authorId },
    select: { firstName: true, lastName: true },
  });
  const acked = Boolean(await ctx.db.announcementAck.findFirst({ where: { announcementId: id, userId: ctx.user.id } }));
  return { ...announcement, author, acked, publisher };
}

/** Accusé de lecture d'une circulaire. */
export async function acknowledgeAnnouncement(ctx: ServiceContext, id: string) {
  const announcement = await found(ctx.db.announcement.findFirst({ where: { id, publishedAt: { not: null } } }));
  if (!(await isRecipient(ctx, id))) throw new ForbiddenError();
  const existing = await ctx.db.announcementAck.findFirst({
    where: { announcementId: announcement.id, userId: ctx.user.id },
  });
  if (!existing)
    await ctx.db.announcementAck.create({
      data: { schoolId: ctx.school.id, announcementId: announcement.id, userId: ctx.user.id },
    });
}

/** Suivi : envois par canal et statut, accusés de lecture, personnes qui n'ont pas encore lu. */
export async function announcementStats(ctx: ServiceContext, id: string) {
  if (!canAll(ctx.scope, "announcement.publish")) throw new ForbiddenError();
  const announcement = await found(ctx.db.announcement.findFirst({ where: { id } }));
  const notifications = await ctx.db.notification.findMany({
    where: { refType: "Announcement", refId: id },
    include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } }, deliveries: true },
  });
  const acks = await ctx.db.announcementAck.findMany({ where: { announcementId: id } });
  const acked = new Set(acks.map((a) => a.userId));
  const deliveries = notifications.flatMap((n) => n.deliveries);
  const byStatus = (status: string) => deliveries.filter((d) => d.status === status).length;
  return {
    announcement,
    recipients: notifications.length,
    readInApp: notifications.filter((n) => n.readAt).length,
    acks: acks.length,
    deliveries: {
      total: deliveries.length,
      queued: byStatus("QUEUED"),
      sent: byStatus("SENT"),
      delivered: byStatus("DELIVERED"),
      read: byStatus("READ"),
      failed: byStatus("FAILED"),
    },
    notAcknowledged: announcement.requiresAck
      ? notifications
          .filter((n) => !acked.has(n.userId))
          .map((n) => ({ id: n.user.id, name: `${n.user.firstName} ${n.user.lastName}`, phone: n.user.phone }))
      : [],
  };
}

/** Relance les destinataires qui n'ont pas encore accusé réception d'une circulaire. */
export async function remindUnacknowledged(ctx: ServiceContext, id: string) {
  const stats = await announcementStats(ctx, id);
  if (!stats.announcement.requiresAck) throw new DomainError("noAckRequired");
  const users = await ctx.db.user.findMany({ where: { id: { in: stats.notAcknowledged.map((u) => u.id) } } });
  for (const u of users) {
    await notifyUser(ctx, u, {
      type: "announcement.reminder",
      title: `Rappel : ${stats.announcement.title}`,
      body: "Merci de lire cette circulaire et de confirmer sa lecture dans LAKOL.",
      link: `/${ctx.school.slug}/announcements/${id}`,
      ref: { type: "AnnouncementReminder", id },
    });
  }
  return { reminded: users.length };
}
