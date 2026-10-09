import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { getStorage } from "@/server/adapters/storage";
import { ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "@/server/services/context";
import {
  computeClassResults,
  createAssessment,
  mockExamStats,
  saveGrades,
  studentResults,
  validateClassTerm,
} from "@/server/services/assessments";
import {
  canReadReportCard,
  familyReportCards,
  generateReportCards,
  publishReportCards,
  saveAppraisal,
  saveCouncilDecision,
  studentCardPdf,
} from "@/server/services/report-cards";
import { contextFor } from "./helpers";

let director: ServiceContext;
let math: ServiceContext;
let english: ServiceContext;
let parent: ServiceContext;
let class7: string;
let terms: { id: string; order: number }[];
let aminata: string;
let mathSubject: string;

beforeAll(async () => {
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
  math = await contextFor("les-etoiles", { email: "prof.maths@les-etoiles.lakol.test" }, "HEAD_TEACHER");
  const mensah = await director.db.staff.findFirstOrThrow({ where: { lastName: "Mensah" } });
  english = await contextFor("les-etoiles", { id: mensah.userId! }, "TEACHER");
  parent = await contextFor("les-etoiles", { phone: "+22370000001" }, "PARENT");
  class7 = (await director.db.class.findFirstOrThrow({ where: { name: "7e A" } })).id;
  terms = await director.db.term.findMany({ where: { academicYear: { isActive: true } }, orderBy: { order: "asc" } });
  aminata = (await director.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0029" } })).id;
  mathSubject = (await director.db.subject.findFirstOrThrow({ where: { code: "MATH" } })).id;
});

afterAll(() => prisma.$disconnect());

describe("saisie des notes", () => {
  it("le professeur crée une évaluation et saisit les notes ; une note hors barème est refusée", async () => {
    const a = await createAssessment(math, {
      classId: class7,
      subjectId: mathSubject,
      termId: terms[1].id,
      type: "QUIZ",
      title: "Interrogation fractions",
      date: new Date("2026-02-10"),
      outOf: 20,
      weight: 1,
    });
    const roster = await director.db.enrollment.findMany({ where: { classId: class7, status: "ACTIVE" } });
    await expect(
      saveGrades(math, { assessmentId: a.id, entries: [{ studentId: roster[0].studentId, value: "25" }] }),
    ).rejects.toThrow("invalidScores");
    const res = await saveGrades(math, {
      assessmentId: a.id,
      entries: roster.map((e, i) => ({ studentId: e.studentId, value: i === 0 ? "abs" : `${10 + (i % 8)},5` })),
    });
    expect(res.saved).toBe(roster.length);
    const absent = await director.db.grade.findFirstOrThrow({
      where: { assessmentId: a.id, studentId: roster[0].studentId },
    });
    expect(absent.isAbsent).toBe(true);

    // Un autre professeur ne saisit pas dans une matière qui n'est pas la sienne.
    await expect(
      saveGrades(english, { assessmentId: a.id, entries: [{ studentId: roster[1].studentId, value: "20" }] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("après validation, seule la direction modifie, et la modification est tracée", async () => {
    await validateClassTerm(director, { classId: class7, termId: terms[1].id });
    const a = await director.db.assessment.findFirstOrThrow({
      where: { classId: class7, termId: terms[1].id, subjectId: mathSubject, title: "Interrogation fractions" },
    });
    expect(a.isLocked).toBe(true);
    const grade = await director.db.grade.findFirstOrThrow({ where: { assessmentId: a.id, isAbsent: false } });

    await expect(
      saveGrades(math, { assessmentId: a.id, entries: [{ studentId: grade.studentId, value: "12" }] }),
    ).rejects.toThrow("assessmentLocked");
    await saveGrades(director, { assessmentId: a.id, entries: [{ studentId: grade.studentId, value: "12" }] });
    const log = await director.db.auditLog.findFirstOrThrow({
      where: { action: "grade.update_after_lock", entityId: grade.id },
    });
    expect(log.before).toMatchObject({ score: grade.score });
    expect(log.after).toMatchObject({ score: 1200 });
  });
});

describe("calcul des résultats", () => {
  it("moyennes, rangs et statistiques cohérents pour la classe", async () => {
    const r = await computeClassResults(director, { classId: class7, termId: terms[0].id });
    expect(r.students.length).toBeGreaterThan(0);
    const first = r.students.find((s) => s.rank === 1)!;
    const best = Math.max(...r.students.map((s) => s.average ?? 0));
    expect(first.average).toBe(best);
    expect(r.classStats.highest).toBe(best);
    // Moyenne générale recalculée à la main pour un élève
    const s = r.students[0];
    const withAvg = s.subjects.filter((x) => x.average !== null);
    const manual = Math.round(
      withAvg.reduce((t, x) => t + x.average! * x.coefficient, 0) / withAvg.reduce((t, x) => t + x.coefficient, 0),
    );
    expect(s.average).toBe(manual);
  });

  it("un parent privé de l'accès aux notes ne les voit pas", async () => {
    await expect(studentResults(parent, { studentId: aminata, termId: terms[0].id })).resolves.toBeTruthy();
    const link = await prisma.studentGuardian.findFirstOrThrow({
      where: { studentId: aminata, guardian: { phone: "+22370000001" } },
    });
    await prisma.studentGuardian.update({ where: { id: link.id }, data: { canViewGrades: false } });
    await expect(studentResults(parent, { studentId: aminata, termId: terms[0].id })).rejects.toThrow(ForbiddenError);
    await prisma.studentGuardian.update({ where: { id: link.id }, data: { canViewGrades: true } });
  });
});

describe("bulletins (parcours 4)", () => {
  it("appréciations : la matière par son professeur, la générale par le professeur principal", async () => {
    await saveAppraisal(math, {
      termId: terms[0].id,
      studentId: aminata,
      subjectId: mathSubject,
      comment: "Bon trimestre, continuez.",
    });
    await saveAppraisal(math, { termId: terms[0].id, studentId: aminata, comment: "Élève sérieuse et appliquée." });
    await expect(saveAppraisal(english, { termId: terms[0].id, studentId: aminata, comment: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      saveAppraisal(english, { termId: terms[0].id, studentId: aminata, subjectId: mathSubject, comment: "x" }),
    ).rejects.toThrow(ForbiddenError);
    await saveCouncilDecision(director, { termId: terms[0].id, studentId: aminata, distinction: "HONOR_ROLL" });
  });

  it("la direction édite les PDF, publie ; le parent est prévenu et peut télécharger", async () => {
    const { generated } = await generateReportCards(director, { classId: class7, termId: terms[0].id });
    expect(generated).toBeGreaterThan(0);
    const card = await prisma.reportCard.findFirstOrThrow({ where: { studentId: aminata, termId: terms[0].id } });
    expect(card.status).toBe("VALIDATED");
    expect(card.generalComment).toBe("Élève sérieuse et appliquée.");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: card.documentId! } });
    const pdf = await getStorage().get(doc.storageKey);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Pas encore publié : invisible pour le parent.
    expect(await canReadReportCard(parent, card.id)).toBe(false);
    await publishReportCards(director, { classId: class7, termId: terms[0].id });
    expect(await canReadReportCard(parent, card.id)).toBe(true);
    expect(
      await prisma.notification.count({ where: { type: "reportcard.published", user: { phone: "+22370000001" } } }),
    ).toBeGreaterThan(0);
    const mine = await familyReportCards(parent);
    expect(mine.some((c) => c.id === card.id && !c.blocked)).toBe(true);
  });

  it("le bulletin est bloqué pour la famille si l'école l'exige et qu'un impayé est échu", async () => {
    const card = await prisma.reportCard.findFirstOrThrow({ where: { studentId: aminata, termId: terms[0].id } });
    await prisma.school.update({ where: { id: parent.school.id }, data: { blockReportIfUnpaid: true } });
    const blockingCtx = { ...parent, school: { ...parent.school, blockReportIfUnpaid: true } };
    expect(await canReadReportCard(blockingCtx, card.id)).toBe(false);
    expect((await familyReportCards(blockingCtx)).find((c) => c.id === card.id)?.blocked).toBe(true);
    // La direction y a toujours accès.
    expect(await canReadReportCard({ ...director, school: blockingCtx.school }, card.id)).toBe(true);
    await prisma.school.update({ where: { id: parent.school.id }, data: { blockReportIfUnpaid: false } });
  });

  it("refuse d'éditer des bulletins si les notes ne sont pas validées", async () => {
    const class9 = await director.db.class.findFirstOrThrow({ where: { name: "9e A" } });
    await expect(generateReportCards(director, { classId: class9.id, termId: terms[1].id })).rejects.toThrow(
      "gradesNotValidated",
    );
  });
});

describe("examens et carte scolaire", () => {
  it("suit les examens blancs du DEF", async () => {
    const class9 = await director.db.class.findFirstOrThrow({ where: { name: "9e A" } });
    const teacher = await director.db.teachingAssignment.findFirstOrThrow({
      where: { classId: class9.id, subjectId: mathSubject },
    });
    const teacherCtx = await contextFor(
      "les-etoiles",
      { id: (await director.db.staff.findUniqueOrThrow({ where: { id: teacher.staffId } })).userId! },
      "HEAD_TEACHER",
    );
    const a = await createAssessment(teacherCtx, {
      classId: class9.id,
      subjectId: mathSubject,
      termId: terms[1].id,
      type: "MOCK_EXAM",
      title: "DEF blanc n°1",
      date: new Date("2026-03-01"),
      outOf: 20,
      weight: 2,
    });
    const roster = await director.db.enrollment.findMany({ where: { classId: class9.id, status: "ACTIVE" } });
    await saveGrades(teacherCtx, {
      assessmentId: a.id,
      entries: roster.map((e, i) => ({ studentId: e.studentId, value: i % 2 ? "8" : "14" })),
    });
    const stats = await mockExamStats(director);
    const def = stats.find((x) => x.classId === class9.id)!;
    expect(def.exam).toBe("DEF");
    expect(def.candidates).toBe(roster.length);
    expect(def.passRate).toBe(Math.round((Math.ceil(roster.length / 2) / roster.length) * 100));
  });

  it("édite la carte scolaire PDF avec QR code", async () => {
    const pdf = await studentCardPdf(director, aminata);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(studentCardPdf(english, aminata)).resolves.toBeTruthy(); // élève de sa classe
    const other = await director.db.enrollment.findFirstOrThrow({ where: { class: { name: "5e A" } } });
    await expect(studentCardPdf(english, other.studentId)).rejects.toThrow(ForbiddenError);
  });
});
