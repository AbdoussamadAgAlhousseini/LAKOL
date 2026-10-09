import { prisma } from "@/server/db/client";
import { forSchool } from "@/server/db/tenant";
import { notifyGuardians, notifyUser } from "@/server/services/notify";
import { sendPaymentReminders } from "@/server/services/finance/reminders";

const DAY = 86_400_000;

/**
 * Rappel des devoirs à rendre dans les 24 h aux élèves qui ne les ont pas
 * faits, et à leurs parents. Un seul message par élève (devoirs regroupés),
 * un seul rappel par devoir.
 */
export async function sendHomeworkReminders(now = new Date()) {
  const homeworks = await prisma.homework.findMany({
    where: {
      deletedAt: null,
      publishedAt: { not: null, lte: now },
      reminderSentAt: null,
      dueAt: { gt: now, lte: new Date(now.getTime() + DAY) },
    },
    include: {
      school: true,
      subject: true,
      submissions: { where: { status: { in: ["DONE", "SUBMITTED", "GRADED"] } }, select: { studentId: true } },
      class: {
        include: {
          enrollments: {
            where: { status: "ACTIVE", deletedAt: null },
            include: { student: { include: { user: true } } },
          },
        },
      },
    },
  });

  // Regroupement : école -> élève -> devoirs en retard
  const bySchool = new Map<
    string,
    {
      school: (typeof homeworks)[number]["school"];
      students: Map<
        string,
        { student: (typeof homeworks)[number]["class"]["enrollments"][number]["student"]; items: string[] }
      >;
    }
  >();
  for (const hw of homeworks) {
    const done = new Set(hw.submissions.map((s) => s.studentId));
    const entry = bySchool.get(hw.schoolId) ?? { school: hw.school, students: new Map() };
    bySchool.set(hw.schoolId, entry);
    for (const { student } of hw.class.enrollments) {
      if (done.has(student.id)) continue;
      const s = entry.students.get(student.id) ?? { student, items: [] };
      s.items.push(`${hw.subject.name} : ${hw.title}`);
      entry.students.set(student.id, s);
    }
  }

  let sent = 0;
  for (const { school, students } of bySchool.values()) {
    const ctx = { db: forSchool(school.id), school };
    for (const { student, items } of students.values()) {
      const message = {
        type: "homework.reminder",
        title: `Devoirs pour demain — ${student.firstName}`,
        body: items.map((i) => `• ${i}`).join("\n"),
        link: `/${school.slug}/homework`,
      };
      if (student.user && student.accountEnabled) await notifyUser(ctx, student.user, message, []);
      sent += await notifyGuardians(ctx, student.id, message);
    }
  }
  if (homeworks.length > 0) {
    await prisma.homework.updateMany({
      where: { id: { in: homeworks.map((h) => h.id) } },
      data: { reminderSentAt: now },
    });
  }
  return { homeworks: homeworks.length, sent };
}

/** Relance hebdomadaire des impayés échus, pour toutes les écoles actives. */
export async function sendAllPaymentReminders() {
  const schools = await prisma.school.findMany({ where: { isActive: true, deletedAt: null } });
  let reminded = 0;
  for (const school of schools) {
    reminded += (await sendPaymentReminders({ db: forSchool(school.id), school })).reminded;
  }
  return { reminded };
}
