import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { forSchool, TenantViolationError } from "@/server/db/tenant";

// Parcours 7 : un utilisateur de l'école A ne peut ni lire ni modifier
// une donnée de l'école B, même en connaissant son identifiant.
let schoolA: string;
let schoolB: string;
let studentOfB: string;

beforeAll(async () => {
  schoolA = (await prisma.school.findUniqueOrThrow({ where: { slug: "les-etoiles" } })).id;
  schoolB = (await prisma.school.findUniqueOrThrow({ where: { slug: "le-savoir" } })).id;
  studentOfB = (await prisma.student.findFirstOrThrow({ where: { schoolId: schoolB } })).id;
});

afterAll(() => prisma.$disconnect());

describe("isolation entre écoles", () => {
  it("les listes ne contiennent que les données de l'école", async () => {
    const students = await forSchool(schoolA).student.findMany();
    expect(students.length).toBe(await prisma.student.count({ where: { schoolId: schoolA } }));
    expect(students.every((s) => s.schoolId === schoolA)).toBe(true);
  });

  it("une lecture par identifiant d'une autre école ne renvoie rien", async () => {
    const db = forSchool(schoolA);
    expect(await db.student.findUnique({ where: { id: studentOfB } })).toBeNull();
    expect(await db.student.findFirst({ where: { id: studentOfB } })).toBeNull();
    expect(await db.grade.count({ where: { studentId: studentOfB } })).toBe(0);
  });

  it("une modification ou suppression ciblant une autre école échoue", async () => {
    const db = forSchool(schoolA);
    await expect(db.student.update({ where: { id: studentOfB }, data: { firstName: "Pirate" } })).rejects.toThrow();
    const res = await db.student.updateMany({ where: { id: studentOfB }, data: { firstName: "Pirate" } });
    expect(res.count).toBe(0);
    await expect(db.student.delete({ where: { id: studentOfB } })).rejects.toThrow();
    const untouched = await prisma.student.findUniqueOrThrow({ where: { id: studentOfB } });
    expect(untouched.firstName).not.toBe("Pirate");
  });

  it("créer une donnée au nom d'une autre école est refusé", async () => {
    const db = forSchool(schoolA);
    await expect(
      db.event.create({
        data: { schoolId: schoolB, type: "EVENT", title: "Intrus", startsAt: new Date(), endsAt: new Date() },
      }),
    ).rejects.toThrow(TenantViolationError);
  });

  it("les agrégats sont limités à l'école", async () => {
    const total = await prisma.enrollment.count();
    const a = await forSchool(schoolA).enrollment.count();
    const b = await forSchool(schoolB).enrollment.count();
    expect(a + b).toBe(total);
    expect(b).toBe(3);
  });

  it("une transaction conserve le filtre d'école", async () => {
    const db = forSchool(schoolA);
    const found = await db.$transaction(async (tx) => tx.student.findUnique({ where: { id: studentOfB } }));
    expect(found).toBeNull();
  });
});
