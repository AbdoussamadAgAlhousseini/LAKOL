import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/server/rbac/policies";
import { sendHomeworkReminders } from "@/server/jobs/reminders";
import type { ServiceContext } from "@/server/services/context";
import {
  attendanceStats,
  getRollCall,
  reviewJustification,
  saveRollCall,
  submitJustification,
} from "@/server/services/attendance";
import { createIncident } from "@/server/services/discipline";
import {
  createHomework,
  getHomework,
  gradeSubmission,
  listHomework,
  markHomeworkDone,
  submitHomework,
} from "@/server/services/homework";
import { addSlot, setException } from "@/server/services/timetable";
import { dayStart, isoDay, addDays } from "@/lib/time";
import { contextFor } from "./helpers";

let admin: ServiceContext;
let math: ServiceContext;
let parent: ServiceContext;
let student: ServiceContext;
let censor: ServiceContext;
let class7: string;
let aminata: string;

beforeAll(async () => {
  admin = await contextFor("les-etoiles", { email: "secretariat@les-etoiles.lakol.test" }, "ADMIN");
  math = await contextFor("les-etoiles", { email: "prof.maths@les-etoiles.lakol.test" }, "TEACHER");
  parent = await contextFor("les-etoiles", { phone: "+22370000001" }, "PARENT");
  student = await contextFor("les-etoiles", { username: "eto-25-0029" }, "STUDENT");
  censor = await contextFor("les-etoiles", { email: "censeur@les-etoiles.lakol.test" }, "CENSOR");
  class7 = (await admin.db.class.findFirstOrThrow({ where: { name: "7e A" } })).id;
  aminata = (await admin.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0029" } })).id;
});

afterAll(() => prisma.$disconnect());

const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

describe("emploi du temps", () => {
  it("refuse un créneau qui chevauche la classe, le professeur ou la salle", async () => {
    const existing = await admin.db.timetableSlot.findFirstOrThrow({
      where: { classId: class7 },
      include: { staff: true },
    });
    // Même classe, même heure
    await expect(
      addSlot(admin, {
        classId: class7,
        subjectId: existing.subjectId,
        dayOfWeek: existing.dayOfWeek,
        startMin: existing.startMin,
        endMin: existing.endMin,
      }),
    ).rejects.toThrow("conflictClass");

    // Même professeur dans une autre classe (9e A n'a pas encore d'emploi du temps)
    const other = await admin.db.teachingAssignment.findFirstOrThrow({
      where: { staffId: existing.staffId, class: { name: "9e A" } },
    });
    await expect(
      addSlot(admin, {
        classId: other.classId,
        subjectId: other.subjectId,
        dayOfWeek: existing.dayOfWeek,
        startMin: existing.startMin + 10,
        endMin: existing.endMin + 10,
      }),
    ).rejects.toThrow("conflictTeacher");

    // Même salle à 16 h : deux classes, deux professeurs différents
    const room = await admin.db.room.findFirstOrThrow({ where: { name: "Laboratoire" } });
    const a9 = await admin.db.teachingAssignment.findFirstOrThrow({
      where: { class: { name: "9e A" }, subject: { code: "PC" } },
    });
    const a11 = await admin.db.teachingAssignment.findFirstOrThrow({
      where: { class: { name: "11e TSE" }, staffId: { not: a9.staffId } },
    });
    await addSlot(admin, {
      classId: a9.classId,
      subjectId: a9.subjectId,
      roomId: room.id,
      dayOfWeek: 2,
      startMin: 960,
      endMin: 1020,
    });
    await expect(
      addSlot(admin, {
        classId: a11.classId,
        subjectId: a11.subjectId,
        roomId: room.id,
        dayOfWeek: 2,
        startMin: 990,
        endMin: 1050,
      }),
    ).rejects.toThrow("conflictRoom");
  });

  it("l'annulation d'un cours prévient les parents de la classe", async () => {
    const slot = await admin.db.timetableSlot.findFirstOrThrow({ where: { classId: class7 } });
    let date = addDays(dayStart(), 1);
    while (isoDay(date) !== slot.dayOfWeek) date = addDays(date, 1);
    const before = await admin.db.notification.count({ where: { type: "timetable.cancelled" } });
    await setException(admin, { slotId: slot.id, date, kind: "CANCELLED", note: "Professeur en formation" });
    expect(await admin.db.notification.count({ where: { type: "timetable.cancelled" } })).toBeGreaterThan(before);
  });
});

describe("devoirs (parcours 3)", () => {
  it("le professeur publie, l'élève voit, dépose son travail, le professeur corrige", async () => {
    const subject = await math.db.subject.findFirstOrThrow({ where: { code: "MATH" } });
    const hw = await createHomework(math, {
      classId: class7,
      subjectId: subject.id,
      title: "Exercices sur les fractions",
      instructions: "Faire les exercices 1 à 4.",
      dueAt: addDays(new Date(), 3),
      allowSubmission: true,
      files: [pdf("fractions.pdf")],
    });

    const family = await listHomework(student, {});
    expect(family.mode).toBe("family");
    const mine = family.mode === "family" ? family.children[0].items.find((h) => h.id === hw.id) : undefined;
    expect(mine).toBeTruthy();
    const detail = await getHomework(student, hw.id);
    expect(detail.attachments).toHaveLength(1);

    await markHomeworkDone(student, { homeworkId: hw.id, studentId: aminata, done: true });
    const submission = await submitHomework(student, {
      homeworkId: hw.id,
      studentId: aminata,
      content: "Voici mon travail",
      files: [pdf("copie.pdf")],
    });
    expect(submission.status).toBe("SUBMITTED");

    // Le parent voit l'état du devoir de son enfant.
    const parentView = await getHomework(parent, hw.id);
    expect(parentView.rows.find((r) => r.student.id === aminata)?.submission?.status).toBe("SUBMITTED");

    await gradeSubmission(math, { submissionId: submission.id, score: 1550, feedback: "Bon travail" });
    const graded = await math.db.homeworkSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(graded.status).toBe("GRADED");
    expect(await math.db.notification.count({ where: { type: "homework.graded", userId: student.user.id } })).toBe(1);
  });

  it("un professeur ne publie pas dans une matière qu'il n'enseigne pas", async () => {
    const english = await contextFor(
      "les-etoiles",
      { id: (await math.db.staff.findFirstOrThrow({ where: { lastName: "Mensah" } })).userId! },
      "TEACHER",
    );
    const subject = await math.db.subject.findFirstOrThrow({ where: { code: "MATH" } });
    await expect(
      createHomework(english, {
        classId: class7,
        subjectId: subject.id,
        title: "x",
        instructions: "x",
        dueAt: addDays(new Date(), 2),
        allowSubmission: false,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rappelle une seule fois les devoirs de demain non faits", async () => {
    const subject = await math.db.subject.findFirstOrThrow({ where: { code: "MATH" } });
    const hw = await createHomework(math, {
      classId: class7,
      subjectId: subject.id,
      title: "Révision pour demain",
      instructions: "Relire la leçon.",
      dueAt: new Date(Date.now() + 12 * 3_600_000),
      allowSubmission: false,
    });
    const first = await sendHomeworkReminders();
    expect(first.sent).toBeGreaterThan(0);
    expect((await prisma.homework.findUniqueOrThrow({ where: { id: hw.id } })).reminderSentAt).not.toBeNull();
    const second = await sendHomeworkReminders();
    expect(second.homeworks).toBe(0);
  });
});

describe("appel (parcours 2)", () => {
  it("le parent de l'élève absent est prévenu une seule fois, même si l'appel est renvoyé", async () => {
    const today = dayStart();
    const sheet = await getRollCall(math, { classId: class7, date: today });
    const entries = sheet.students.map((s, i) => ({
      studentId: s.id,
      status: s.id === aminata ? ("ABSENT" as const) : ("PRESENT" as const),
      clientId: `test-${today.toISOString()}-${i}`,
    }));
    const before = await prisma.notificationDelivery.count({
      where: { recipient: "+22370000001", notification: { type: "attendance.absent" } },
    });

    const result = await saveRollCall(math, { classId: class7, date: today, entries });
    expect(result.notified).toBe(1);
    const after = await prisma.notificationDelivery.count({
      where: { recipient: "+22370000001", notification: { type: "attendance.absent" } },
    });
    expect(after).toBe(before + 1);

    // Renvoi hors ligne du même appel : rien de nouveau.
    const replay = await saveRollCall(math, { classId: class7, date: today, entries });
    expect(replay.notified).toBe(0);
    expect(await math.db.attendance.count({ where: { classId: class7, date: today, timetableSlotId: null } })).toBe(
      entries.length,
    );
  });

  it("un professeur ne fait pas l'appel d'une classe qui n'est pas la sienne", async () => {
    const english = await contextFor(
      "les-etoiles",
      { id: (await math.db.staff.findFirstOrThrow({ where: { lastName: "Mensah" } })).userId! },
      "TEACHER",
    );
    const class5 = await admin.db.class.findFirstOrThrow({ where: { name: "5e A" } });
    await expect(getRollCall(english, { classId: class5.id, date: dayStart() })).rejects.toThrow(ForbiddenError);
  });

  it("le parent justifie, la vie scolaire valide ; les statistiques en tiennent compte", async () => {
    const absence = await prisma.attendance.findFirstOrThrow({
      where: { studentId: aminata, status: "ABSENT", date: dayStart() },
    });
    await submitJustification(parent, {
      attendanceId: absence.id,
      reason: "Rendez-vous médical",
      file: pdf("certificat.pdf"),
    });
    await expect(reviewJustification(math, { attendanceId: absence.id, accept: true })).rejects.toThrow(ForbiddenError);
    await reviewJustification(censor, { attendanceId: absence.id, accept: true });
    const updated = await prisma.attendance.findUniqueOrThrow({ where: { id: absence.id } });
    expect(updated.status).toBe("EXCUSED");
    expect(updated.justified).toBe(true);

    const stats = await attendanceStats(parent, { studentId: aminata, from: addDays(dayStart(), -30), to: dayStart() });
    expect(stats.excused).toBeGreaterThanOrEqual(1);
    expect(stats.rate).not.toBeNull();
  });
});

describe("discipline", () => {
  it("une sanction prévient les parents ; un professeur ne peut pas en créer", async () => {
    await createIncident(censor, {
      studentId: aminata,
      type: "SANCTION",
      date: dayStart(),
      description: "Retards répétés",
      sanction: "Retenue mercredi",
    });
    expect(
      await prisma.notification.count({ where: { type: "discipline.sanction", user: { phone: "+22370000001" } } }),
    ).toBe(1);
    await expect(
      createIncident(math, { studentId: aminata, type: "WARNING", date: dayStart(), description: "x" }),
    ).rejects.toThrow(ForbiddenError);
  });
});
