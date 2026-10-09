import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "@/server/services/context";
import {
  getConversation,
  listContacts,
  listReportedMessages,
  reportMessage,
  sendMessage,
  setMessageHidden,
  startConversation,
  unreadMessageCount,
} from "@/server/services/messaging";
import {
  acknowledgeAnnouncement,
  announcementStats,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  remindUnacknowledged,
} from "@/server/services/announcements";
import { markNotificationsRead, unreadNotificationCount } from "@/server/services/notifications";
import { availableSlots, bookSlot, cancelBooking, createSlots, listMySlots } from "@/server/services/meetings";
import { flushDeliveries } from "@/server/jobs/handlers";
import { applyWhatsAppStatuses, verifyWhatsAppSignature } from "@/server/platform/whatsapp-webhook";
import { canReadMessageAttachment } from "@/server/services/messaging";
import { contextFor } from "./helpers";

let director: ServiceContext;
let teacher: ServiceContext;
let parent: ServiceContext;
let otherParent: ServiceContext;
let english: ServiceContext;
let aminata: string;

beforeAll(async () => {
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
  teacher = await contextFor("les-etoiles", { email: "prof.maths@les-etoiles.lakol.test" }, "HEAD_TEACHER");
  parent = await contextFor("les-etoiles", { phone: "+22370000001" }, "PARENT");
  aminata = (await director.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0029" } })).id;
  // Parent d'un élève de 5e A uniquement (autre famille, autre classe).
  const other = await prisma.guardian.findFirstOrThrow({
    where: {
      schoolId: parent.school.id,
      user: {
        roles: { some: { schoolId: parent.school.id, role: { key: "PARENT" } }, every: { role: { key: "PARENT" } } },
        staffProfiles: { none: {} },
      },
      students: {
        some: { student: { enrollments: { some: { status: "ACTIVE", class: { name: "5e A" } } } } },
        none: { student: { enrollments: { some: { status: "ACTIVE", class: { name: "7e A" } } } } },
      },
    },
  });
  const mensah = await director.db.staff.findFirstOrThrow({ where: { lastName: "Mensah" } });
  english = await contextFor("les-etoiles", { id: mensah.userId! }, "TEACHER");
  otherParent = await contextFor("les-etoiles", { id: other.userId! }, "PARENT");
});

afterAll(() => prisma.$disconnect());

describe("messagerie", () => {
  it("le parent écrit au professeur de son enfant ; pas de messagerie entre parents", async () => {
    const contacts = await listContacts(parent);
    const prof = contacts.find((c) => c.userId === teacher.user.id && c.studentId === aminata);
    expect(prof).toBeTruthy();
    expect(contacts.some((c) => c.userId === otherParent.user.id)).toBe(false);
    await expect(startConversation(parent, { toUserId: otherParent.user.id, body: "Bonjour" })).rejects.toThrow(
      ForbiddenError,
    );

    const before = await unreadMessageCount(teacher);
    const conv = await startConversation(parent, {
      toUserId: teacher.user.id,
      studentId: aminata,
      subject: "Devoir de maths",
      body: "Bonjour, Aminata n'a pas compris l'exercice 3.",
    });
    expect(await unreadMessageCount(teacher)).toBe(before + 1);

    // Une deuxième prise de contact reprend la même conversation.
    const again = await startConversation(parent, { toUserId: teacher.user.id, studentId: aminata, body: "Merci !" });
    expect(again.id).toBe(conv.id);

    // Un seul WhatsApp tant que le professeur n'a pas lu.
    const deliveries = await prisma.notificationDelivery.count({
      where: { channel: "WHATSAPP", notification: { userId: teacher.user.id, refId: conv.id } },
    });
    expect(deliveries).toBeLessThanOrEqual(1);

    const thread = await getConversation(teacher, conv.id);
    expect(thread.messages.slice(-2).map((m) => m.body)).toEqual([
      "Bonjour, Aminata n'a pas compris l'exercice 3.",
      "Merci !",
    ]);
    expect(await unreadMessageCount(teacher)).toBe(before);
    await sendMessage(teacher, { conversationId: conv.id, body: "Je le réexplique demain en classe." });

    // Un tiers ne lit pas la conversation.
    await expect(getConversation(otherParent, conv.id)).rejects.toThrow(ForbiddenError);
  });

  it("message vocal : stocké, lisible par les participants uniquement", async () => {
    const conv = await startConversation(parent, { toUserId: teacher.user.id, studentId: aminata, body: "Vocal" });
    const audio = new File([new Uint8Array(2000).fill(1)], "voice.webm", { type: "audio/webm;codecs=opus" });
    const message = await sendMessage(parent, { conversationId: conv.id, audio });
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.audioUrl).toMatch(/^\/api\/files\//);
    expect(await canReadMessageAttachment(teacher, message.id)).toBe(true);
    expect(await canReadMessageAttachment(otherParent, message.id)).toBe(false);
    await expect(
      sendMessage(parent, {
        conversationId: conv.id,
        audio: new File(["x"], "a.exe", { type: "application/x-msdownload" }),
      }),
    ).rejects.toThrow("fileType");
    await expect(sendMessage(parent, { conversationId: conv.id, body: "   " })).rejects.toThrow("emptyMessage");
  });

  it("modération : signalement, masquage tracé", async () => {
    const conv = await startConversation(teacher, { toUserId: parent.user.id, studentId: aminata, body: "Message" });
    const msg = await prisma.message.findFirstOrThrow({
      where: { conversationId: conv.id, senderId: teacher.user.id },
    });
    await expect(reportMessage(teacher, { messageId: msg.id, reason: "x" })).rejects.toThrow("cannotReportOwn");
    await reportMessage(parent, { messageId: msg.id, reason: "Propos déplacés" });
    expect((await listReportedMessages(director)).some((m) => m.id === msg.id)).toBe(true);
    await expect(listReportedMessages(parent)).rejects.toThrow(ForbiddenError);
    await setMessageHidden(director, { messageId: msg.id, hidden: true });
    const thread = await getConversation(parent, conv.id);
    expect(thread.messages.find((m) => m.id === msg.id)?.body).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "message.hide", entityId: msg.id } })).toBe(1);
  });
});

describe("annonces et circulaires", () => {
  it("annonce à une classe avec accusé de lecture, suivi et relance", async () => {
    const class7 = await director.db.class.findFirstOrThrow({ where: { name: "7e A" } });
    await expect(
      createAnnouncement(teacher, {
        title: "x",
        body: "x",
        audience: "SCHOOL",
        targetIds: [],
        requiresAck: false,
        channels: [],
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createAnnouncement(director, {
        title: "x",
        body: "x",
        audience: "CLASS",
        targetIds: [],
        requiresAck: false,
        channels: [],
      }),
    ).rejects.toThrow("targetsRequired");

    const a = await createAnnouncement(director, {
      title: "Sortie au musée national",
      body: "La classe de 7e A visitera le musée national jeudi. Merci de signer l'autorisation.",
      audience: "CLASS",
      targetIds: [class7.id],
      requiresAck: true,
      channels: ["WHATSAPP"],
    });
    expect(a.recipientCount).toBeGreaterThan(1);

    // Le parent (Aminata est en 7e A) la reçoit ; un parent d'une autre classe non.
    expect((await listAnnouncements(parent, {})).items.some((x) => x.id === a.id)).toBe(true);
    await expect(getAnnouncement(otherParent, a.id)).rejects.toThrow(ForbiddenError);

    const stats = await announcementStats(director, a.id);
    expect(stats.recipients).toBe(a.recipientCount);
    expect(stats.deliveries.total).toBeGreaterThan(0);
    expect(stats.notAcknowledged.length).toBe(a.recipientCount);

    const unread = await unreadNotificationCount(parent);
    const seen = await getAnnouncement(parent, a.id);
    expect(seen.acked).toBe(false);
    expect(await unreadNotificationCount(parent)).toBe(unread - 1);
    await acknowledgeAnnouncement(parent, a.id);
    await acknowledgeAnnouncement(parent, a.id); // idempotent
    const after = await announcementStats(director, a.id);
    expect(after.acks).toBe(1);
    expect(after.notAcknowledged.some((u) => u.id === parent.user.id)).toBe(false);

    const { reminded } = await remindUnacknowledged(director, a.id);
    expect(reminded).toBe(a.recipientCount - 1);
    await markNotificationsRead(parent);
    expect(await unreadNotificationCount(parent)).toBe(0);
  });
});

describe("rendez-vous parents-professeurs", () => {
  it("le professeur ouvre des créneaux, le parent réserve, un créneau ne se réserve qu'une fois", async () => {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() + 7);
    await createSlots(teacher, { date: day, startMin: 14 * 60, count: 3, durationMin: 15, location: "Salle 7A" });
    await expect(
      createSlots(teacher, { date: day, startMin: 14 * 60 + 20, count: 1, durationMin: 15 }),
    ).rejects.toThrow("slotOverlap");
    await expect(
      createSlots(teacher, { date: new Date("2020-01-01"), startMin: 600, count: 1, durationMin: 15 }),
    ).rejects.toThrow("dateInPast");
    await expect(createSlots(parent, { date: day, startMin: 600, count: 1, durationMin: 15 })).rejects.toThrow(
      ForbiddenError,
    );

    const offer = await availableSlots(parent);
    const mine = offer.find((t) => t.staffId === teacher.staffId)!;
    expect(mine.slots.length).toBeGreaterThanOrEqual(3);
    const slot = mine.slots[0];
    await bookSlot(parent, { slotId: slot.id, studentId: aminata, note: "Résultats du trimestre" });
    await expect(bookSlot(parent, { slotId: slot.id, studentId: aminata })).rejects.toThrow("slotTaken");

    // Un parent dont l'enfant n'a pas ce professeur (anglais, pas en 5e A) ne réserve pas.
    await createSlots(english, { date: day, startMin: 15 * 60, count: 1, durationMin: 15 });
    const englishSlot = (await listMySlots(english))[0];
    const otherChild = [...otherParent.scope.studentIds][0];
    await expect(bookSlot(otherParent, { slotId: englishSlot.id, studentId: otherChild })).rejects.toThrow(
      ForbiddenError,
    );
    expect((await availableSlots(otherParent)).some((t) => t.staffId === english.staffId)).toBe(false);

    const booked = (await listMySlots(teacher)).find((s) => s.id === slot.id)!;
    expect(booked.status).toBe("BOOKED");
    expect(
      await prisma.notification.count({ where: { userId: teacher.user.id, type: "meeting.booked" } }),
    ).toBeGreaterThan(0);
    await cancelBooking(parent, slot.id);
    expect((await prisma.meetingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("OPEN");
  });
});

describe("envois différés et suivi WhatsApp", () => {
  it("les envois programmés partent au flush ; les statuts Meta mettent à jour le suivi", async () => {
    const notification = await prisma.notification.findFirstOrThrow({ where: { userId: parent.user.id } });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        schoolId: parent.school.id,
        notificationId: notification.id,
        channel: "WHATSAPP",
        recipient: "+22370000001",
        scheduledFor: new Date(Date.now() - 1000),
      },
    });
    const later = await prisma.notificationDelivery.create({
      data: {
        schoolId: parent.school.id,
        notificationId: notification.id,
        channel: "WHATSAPP",
        recipient: "+22370000001",
        scheduledFor: new Date(Date.now() + 3600_000),
      },
    });
    await flushDeliveries();
    const sent = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(sent.status).toBe("SENT");
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("QUEUED");

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: sent.providerMessageId, status: "read", timestamp: String(Math.floor(Date.now() / 1000)) },
                  { id: sent.providerMessageId, status: "delivered" }, // en retard : ignoré
                ],
              },
            },
          ],
        },
      ],
    };
    await applyWhatsAppStatuses(payload as Parameters<typeof applyWhatsAppStatuses>[0]);
    const read = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(read.status).toBe("READ");
    expect(read.deliveredAt).not.toBeNull();

    const raw = JSON.stringify(payload);
    const sig = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(verifyWhatsAppSignature(raw, sig, "secret")).toBe(true);
    expect(verifyWhatsAppSignature(raw, "sha256=00", "secret")).toBe(false);
    await prisma.notificationDelivery.delete({ where: { id: later.id } });
  });
});
