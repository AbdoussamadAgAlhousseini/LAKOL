import "server-only";
import { randomUUID } from "node:crypto";
import { audit } from "@/server/audit";
import { getStorage } from "@/server/adapters/storage";
import { DomainError, NotFoundError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { actor, type ServiceContext } from "./context";
import { notifyUser } from "./notify";
import { found, getActiveYear } from "./structure";

const OFFICE_ROLES = ["DIRECTOR", "ADMIN", "CENSOR", "ACCOUNTANT"];
const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
};
const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // ~3 minutes de message vocal

export interface Contact {
  userId: string;
  name: string;
  /** Pour qui / à quel titre (ex. « Professeur de Maths — Aminata »). */
  detail: string;
  studentId?: string;
}

function messagingKind(ctx: ServiceContext): "office" | "teacher" | "family" {
  if (canAll(ctx.scope, "student.read")) return "office";
  if (ctx.staffId) return "teacher";
  return "family";
}

/** Membres du personnel (avec compte) de l'école. */
async function staffContacts(ctx: ServiceContext): Promise<Contact[]> {
  const staff = await ctx.db.staff.findMany({
    where: { isActive: true, deletedAt: null, userId: { not: null } },
    orderBy: [{ lastName: "asc" }],
  });
  return staff
    .filter((s) => s.userId !== ctx.user.id)
    .map((s) => ({ userId: s.userId!, name: `${s.firstName} ${s.lastName}`, detail: s.position }));
}

/** Tuteurs (avec compte) des élèves donnés. */
async function guardianContacts(ctx: ServiceContext, studentIds: string[] | "all", q?: string): Promise<Contact[]> {
  const links = await ctx.db.studentGuardian.findMany({
    where: {
      ...(studentIds === "all" ? {} : { studentId: { in: studentIds } }),
      guardian: { userId: { not: null }, deletedAt: null },
      student: {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { lastName: { contains: q, mode: "insensitive" } },
                { firstName: { contains: q, mode: "insensitive" } },
                { matricule: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    },
    include: { guardian: true, student: true },
    take: 200,
  });
  return links.map((l) => ({
    userId: l.guardian.userId!,
    name: `${l.guardian.firstName} ${l.guardian.lastName}`,
    detail: `Parent de ${l.student.firstName} ${l.student.lastName}`,
    studentId: l.studentId,
  }));
}

/**
 * Personnes à qui l'utilisateur peut écrire :
 * - administration : tout le personnel et tous les parents (recherche) ;
 * - professeur : le personnel et les parents de ses élèves ;
 * - parent : les professeurs de ses enfants et l'administration.
 * Pas de messagerie entre parents.
 */
export async function listContacts(ctx: ServiceContext, q?: string): Promise<Contact[]> {
  if (!ctx.scope.permissions.has("message.send")) throw new ForbiddenError();
  const kind = messagingKind(ctx);
  if (kind === "office") {
    return [...(await staffContacts(ctx)), ...(q ? await guardianContacts(ctx, "all", q) : [])];
  }
  if (kind === "teacher") {
    return [...(await staffContacts(ctx)), ...(await guardianContacts(ctx, [...ctx.scope.studentIds], q))];
  }
  // Parent : professeurs et professeur principal des classes de ses enfants + administration
  const year = await getActiveYear(ctx);
  const enrollments = await ctx.db.enrollment.findMany({
    where: {
      studentId: { in: [...ctx.scope.studentIds] },
      academicYearId: year?.id ?? "",
      status: "ACTIVE",
      deletedAt: null,
    },
    include: {
      student: true,
      class: {
        include: {
          headTeacher: true,
          teachingAssignments: { include: { staff: true, subject: true } },
        },
      },
    },
  });
  const contacts = new Map<string, Contact>();
  for (const e of enrollments) {
    for (const a of e.class.teachingAssignments) {
      if (!a.staff.userId || !a.staff.isActive) continue;
      const key = `${a.staff.userId}:${e.studentId}`;
      const existing = contacts.get(key);
      const subject = a.subject.name;
      contacts.set(key, {
        userId: a.staff.userId,
        name: `${a.staff.firstName} ${a.staff.lastName}`,
        detail: existing ? `${existing.detail}, ${subject}` : `Professeur de ${subject} — ${e.student.firstName}`,
        studentId: e.studentId,
      });
    }
    const head = e.class.headTeacher;
    if (head?.userId && !contacts.has(`${head.userId}:${e.studentId}`)) {
      contacts.set(`${head.userId}:${e.studentId}`, {
        userId: head.userId,
        name: `${head.firstName} ${head.lastName}`,
        detail: `Professeur principal — ${e.student.firstName}`,
        studentId: e.studentId,
      });
    }
  }
  const office = await ctx.db.userRole.findMany({
    where: { role: { key: { in: OFFICE_ROLES } }, user: { isActive: true, deletedAt: null } },
    include: { user: true, role: true },
  });
  for (const o of office) {
    if (![...contacts.values()].some((c) => c.userId === o.userId && !c.studentId)) {
      contacts.set(o.userId, { userId: o.userId, name: `${o.user.firstName} ${o.user.lastName}`, detail: o.role.name });
    }
  }
  const all = [...contacts.values()];
  return q ? all.filter((c) => `${c.name} ${c.detail}`.toLowerCase().includes(q.toLowerCase())) : all;
}

/** L'utilisateur peut-il écrire à cette personne (à propos de cet élève) ? */
async function canContact(ctx: ServiceContext, userId: string, studentId?: string | null) {
  if (userId === ctx.user.id) return false;
  const kind = messagingKind(ctx);
  const isStaff = await ctx.db.staff.findFirst({ where: { userId, isActive: true, deletedAt: null } });
  if (kind === "office") {
    if (isStaff) return true;
    return Boolean(await ctx.db.guardian.findFirst({ where: { userId, deletedAt: null } }));
  }
  if (kind === "teacher") {
    if (isStaff) return true;
    return Boolean(
      await ctx.db.studentGuardian.findFirst({
        where: { studentId: { in: [...ctx.scope.studentIds] }, guardian: { userId } },
      }),
    );
  }
  const contacts = await listContacts(ctx);
  return contacts.some((c) => c.userId === userId && (!studentId || !c.studentId || c.studentId === studentId));
}

// ── Conversations ──────────────────────────────────────────────────────────

/**
 * Écrit à quelqu'un : reprend la conversation existante entre les deux
 * personnes (à propos du même élève) ou en ouvre une nouvelle.
 */
export async function startConversation(
  ctx: ServiceContext,
  input: {
    toUserId: string;
    studentId?: string | null;
    subject?: string | null;
    body?: string | null;
    audio?: File | null;
  },
) {
  if (!ctx.scope.permissions.has("message.send")) throw new ForbiddenError();
  if (!(await canContact(ctx, input.toUserId, input.studentId))) throw new ForbiddenError();
  const studentId = input.studentId ?? null;
  const candidates = await ctx.db.conversation.findMany({
    where: {
      studentId,
      AND: [
        { participants: { some: { userId: ctx.user.id } } },
        { participants: { some: { userId: input.toUserId } } },
      ],
    },
    include: { _count: { select: { participants: true } } },
    orderBy: { updatedAt: "desc" },
  });
  let conversation = candidates.find((c) => c._count.participants === 2);
  if (!conversation) {
    const created = await ctx.db.conversation.create({
      data: { schoolId: ctx.school.id, subject: input.subject ?? null, studentId },
    });
    await ctx.db.conversationParticipant.createMany({
      data: [
        { schoolId: ctx.school.id, conversationId: created.id, userId: ctx.user.id, lastReadAt: new Date() },
        { schoolId: ctx.school.id, conversationId: created.id, userId: input.toUserId },
      ],
    });
    conversation = { ...created, _count: { participants: 2 } };
  }
  if (input.body || input.audio)
    await sendMessage(ctx, { conversationId: conversation.id, body: input.body, audio: input.audio });
  return conversation;
}

async function requireParticipant(ctx: ServiceContext, conversationId: string) {
  const participant = await ctx.db.conversationParticipant.findFirst({
    where: { conversationId, userId: ctx.user.id },
  });
  if (!participant) throw new ForbiddenError();
  return participant;
}

/** Envoie un message (texte et/ou vocal) ; les autres participants sont prévenus. */
export async function sendMessage(
  ctx: ServiceContext,
  input: { conversationId: string; body?: string | null; audio?: File | null },
) {
  if (!ctx.scope.permissions.has("message.send")) throw new ForbiddenError();
  await requireParticipant(ctx, input.conversationId);
  const body = input.body?.trim() || null;
  if (!body && !input.audio) throw new DomainError("emptyMessage", "body");
  if (input.audio) {
    const type = input.audio.type.split(";")[0];
    if (!AUDIO_TYPES[type]) throw new DomainError("fileType", "audio");
    if (input.audio.size > MAX_AUDIO_BYTES) throw new DomainError("fileTooLarge", "audio");
  }

  const message = await ctx.db.message.create({
    data: { schoolId: ctx.school.id, conversationId: input.conversationId, senderId: ctx.user.id, body },
  });
  if (input.audio) {
    const type = input.audio.type.split(";")[0];
    const key = `schools/${ctx.school.id}/messages/${input.conversationId}/${randomUUID()}.${AUDIO_TYPES[type]}`;
    await getStorage().put(key, Buffer.from(await input.audio.arrayBuffer()), type);
    const doc = await ctx.db.document.create({
      data: {
        schoolId: ctx.school.id,
        entityType: "Message",
        entityId: message.id,
        category: "AUDIO",
        name: "message-vocal",
        mimeType: type,
        size: input.audio.size,
        storageKey: key,
        uploadedById: ctx.user.id,
      },
    });
    await ctx.db.message.update({ where: { id: message.id }, data: { audioUrl: `/api/files/${doc.id}` } });
  }
  await ctx.db.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
  await ctx.db.conversationParticipant.updateMany({
    where: { conversationId: input.conversationId, userId: ctx.user.id },
    data: { lastReadAt: new Date() },
  });

  const others = await ctx.db.conversationParticipant.findMany({
    where: { conversationId: input.conversationId, userId: { not: ctx.user.id } },
    include: { user: true },
  });
  const sender = `${ctx.user.firstName} ${ctx.user.lastName}`;
  for (const p of others) {
    // Un seul WhatsApp tant que le destinataire n'a pas lu les messages précédents.
    const pending = await ctx.db.notification.count({
      where: { userId: p.userId, refType: "Conversation", refId: input.conversationId, readAt: null },
    });
    await notifyUser(
      ctx,
      p.user,
      {
        type: "message.new",
        title: `Message de ${sender}`,
        body: body ? body.slice(0, 280) : "Message vocal",
        link: `/${ctx.school.slug}/messages/${input.conversationId}`,
        ref: { type: "Conversation", id: input.conversationId },
      },
      pending > 0 ? [] : ["WHATSAPP", "EMAIL"],
    );
  }
  return message;
}

/** Conversations de l'utilisateur, avec dernier message et nombre de non-lus. */
export async function listConversations(ctx: ServiceContext) {
  const participations = await ctx.db.conversationParticipant.findMany({
    where: { userId: ctx.user.id },
    include: {
      conversation: {
        include: {
          participants: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { conversation: { updatedAt: "desc" } },
    take: 100,
  });
  const studentIds = participations.map((p) => p.conversation.studentId).filter((x): x is string => Boolean(x));
  const students = await ctx.db.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  return Promise.all(
    participations.map(async (p) => {
      const unread = await ctx.db.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: ctx.user.id },
          deletedAt: null,
          ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
        },
      });
      const others = p.conversation.participants
        .filter((x) => x.userId !== ctx.user.id)
        .map((x) => `${x.user.firstName} ${x.user.lastName}`);
      const student = students.find((s) => s.id === p.conversation.studentId);
      return {
        id: p.conversationId,
        with: others.join(", "),
        subject: p.conversation.subject,
        student: student ? `${student.firstName} ${student.lastName}` : null,
        last: p.conversation.messages[0] ?? null,
        unread,
      };
    }),
  );
}

export async function unreadMessageCount(ctx: ServiceContext) {
  const parts = await ctx.db.conversationParticipant.findMany({
    where: { userId: ctx.user.id },
    select: { conversationId: true, lastReadAt: true },
  });
  let total = 0;
  for (const p of parts) {
    total += await ctx.db.message.count({
      where: {
        conversationId: p.conversationId,
        senderId: { not: ctx.user.id },
        deletedAt: null,
        ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
      },
    });
  }
  return total;
}

/** Ouvre une conversation (participants uniquement) et la marque comme lue. */
export async function getConversation(ctx: ServiceContext, id: string) {
  await requireParticipant(ctx, id);
  const conversation = await ctx.db.conversation.findUnique({
    where: { id },
    include: {
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 200,
        include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!conversation) throw new NotFoundError();
  const student = conversation.studentId
    ? await ctx.db.student.findUnique({
        where: { id: conversation.studentId },
        select: { firstName: true, lastName: true },
      })
    : null;
  const now = new Date();
  await ctx.db.conversationParticipant.updateMany({
    where: { conversationId: id, userId: ctx.user.id },
    data: { lastReadAt: now },
  });
  await ctx.db.notification.updateMany({
    where: { userId: ctx.user.id, refType: "Conversation", refId: id, readAt: null },
    data: { readAt: now },
  });
  // Un message masqué par l'école n'est plus lisible (texte et audio).
  const messages = conversation.messages.map((m) => (m.hiddenAt ? { ...m, body: null, audioUrl: null } : m));
  return { ...conversation, messages, student };
}

// ── Modération ─────────────────────────────────────────────────────────────

/** Un participant signale un message inapproprié à l'école. */
export async function reportMessage(ctx: ServiceContext, input: { messageId: string; reason: string }) {
  const message = await found(ctx.db.message.findFirst({ where: { id: input.messageId, deletedAt: null } }));
  await requireParticipant(ctx, message.conversationId);
  if (message.senderId === ctx.user.id) throw new DomainError("cannotReportOwn");
  await ctx.db.message.update({
    where: { id: message.id },
    data: { reportedAt: new Date(), reportedById: ctx.user.id, reportReason: input.reason },
  });
}

/** Messages signalés (modération) : seul le message signalé est visible, pas toute la conversation. */
export async function listReportedMessages(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "message.moderate")) throw new ForbiddenError();
  return ctx.db.message.findMany({
    where: { reportedAt: { not: null }, deletedAt: null },
    include: { sender: { select: { firstName: true, lastName: true } } },
    orderBy: { reportedAt: "desc" },
    take: 100,
  });
}

export async function setMessageHidden(ctx: ServiceContext, input: { messageId: string; hidden: boolean }) {
  if (!canAll(ctx.scope, "message.moderate")) throw new ForbiddenError();
  const message = await found(ctx.db.message.findFirst({ where: { id: input.messageId, deletedAt: null } }));
  if (!message.reportedAt) throw new ForbiddenError(); // seuls les messages signalés sont modérables
  await ctx.db.message.update({
    where: { id: message.id },
    data: input.hidden
      ? { hiddenAt: new Date(), hiddenById: ctx.user.id }
      : { hiddenAt: null, hiddenById: null, reportedAt: null, reportReason: null },
  });
  await audit(ctx.db, actor(ctx), {
    action: input.hidden ? "message.hide" : "message.restore",
    entityType: "Message",
    entityId: message.id,
    before: { body: message.body, reportReason: message.reportReason },
  });
}

/** Droit de lire la pièce audio d'un message (participant, ou modérateur si signalé). */
export async function canReadMessageAttachment(ctx: ServiceContext, messageId: string) {
  const message = await ctx.db.message.findFirst({ where: { id: messageId, deletedAt: null } });
  if (!message) return false;
  if (message.hiddenAt && !canAll(ctx.scope, "message.moderate")) return false;
  const participant = await ctx.db.conversationParticipant.findFirst({
    where: { conversationId: message.conversationId, userId: ctx.user.id },
  });
  return Boolean(participant) || (Boolean(message.reportedAt) && canAll(ctx.scope, "message.moderate"));
}
