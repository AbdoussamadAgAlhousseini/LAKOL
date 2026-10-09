import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { DomainError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "@/server/services/context";
import {
  changeStudentStatus,
  createStudent,
  enableStudentAccount,
  getStudent,
  listStudents,
  resendGuardianAccess,
  unlinkGuardian,
} from "@/server/services/students";
import { contextFor, uniquePhone, whatsapp } from "./helpers";

let secretary: ServiceContext;
let teacher: ServiceContext;
let class7: string;
let class5: string;

beforeAll(async () => {
  secretary = await contextFor("les-etoiles", { email: "secretariat@les-etoiles.lakol.test" }, "ADMIN");
  teacher = await contextFor("les-etoiles", { email: "prof.maths@les-etoiles.lakol.test" }, "TEACHER");
  const classes = await secretary.db.class.findMany();
  class7 = classes.find((c) => c.name === "7e A")!.id;
  class5 = classes.find((c) => c.name === "5e A")!.id;
});

afterAll(() => prisma.$disconnect());

const identity = {
  firstName: "Salimata",
  lastName: "Coulibaly",
  gender: "FEMALE" as const,
  birthDate: new Date("2013-05-04"),
};

describe("inscription d'un élève", () => {
  it("crée la fiche, le matricule, l'inscription et le compte du parent avec envoi WhatsApp", async () => {
    const phone = uniquePhone();
    const sentBefore = whatsapp().sent.length;
    const student = await createStudent(secretary, {
      ...identity,
      classId: class7,
      guardians: [{ firstName: "Drissa", lastName: "Coulibaly", phone, relationship: "FATHER" }],
    });

    expect(student.matricule).toMatch(/^LES-25-\d{4}$/);
    const enrollment = await secretary.db.enrollment.findFirst({ where: { studentId: student.id } });
    expect(enrollment?.classId).toBe(class7);

    const parent = await prisma.user.findUniqueOrThrow({
      where: { phone },
      include: { roles: { include: { role: true } } },
    });
    expect(parent.mustChangePwd).toBe(true);
    expect(parent.roles.map((r) => r.role.key)).toEqual(["PARENT"]);

    const message = whatsapp()
      .sent.slice(sentBefore)
      .find((m) => m.to === phone);
    expect(message?.body).toContain(phone);
    const password = message!.body.match(/provisoire : (\S+)/)![1];
    expect(await verifyPassword(parent.passwordHash!, password)).toBe(true);

    const delivery = await secretary.db.notificationDelivery.findFirst({ where: { recipient: phone } });
    expect(delivery?.status).toBe("SENT");
  });

  it("deux inscriptions successives ont des matricules consécutifs", async () => {
    const make = () =>
      createStudent(secretary, {
        ...identity,
        firstName: "Test",
        classId: class7,
        guardians: [{ firstName: "P", lastName: "P", phone: uniquePhone(), relationship: "MOTHER" }],
        sendAccess: false,
      });
    const a = await make();
    const b = await make();
    expect(Number(b.matricule.slice(-4))).toBe(Number(a.matricule.slice(-4)) + 1);
  });

  it("réutilise le compte d'un parent déjà inscrit dans une autre école, sans changer son mot de passe", async () => {
    const savoir = await prisma.school.findUniqueOrThrow({ where: { slug: "le-savoir" } });
    const guardianB = await prisma.guardian.findFirstOrThrow({
      where: { schoolId: savoir.id },
      include: { user: true },
    });
    const hashBefore = guardianB.user!.passwordHash;
    const sentBefore = whatsapp().sent.length;

    const student = await createStudent(secretary, {
      ...identity,
      firstName: "Fratrie",
      classId: class7,
      guardians: [{ firstName: "X", lastName: "Y", phone: guardianB.phone, relationship: "FATHER" }],
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: guardianB.userId! }, include: { roles: true } });
    expect(user.passwordHash).toBe(hashBefore);
    expect(new Set(user.roles.map((r) => r.schoolId)).size).toBe(2);
    const message = whatsapp()
      .sent.slice(sentBefore)
      .find((m) => m.to === guardianB.phone);
    expect(message?.body).toContain("compte LAKOL habituel");

    // L'école A ne peut pas réinitialiser un compte qui sert aussi à l'école B.
    const link = await secretary.db.studentGuardian.findFirstOrThrow({ where: { studentId: student.id } });
    await expect(resendGuardianAccess(secretary, link.guardianId)).rejects.toThrow("accountShared");
    await expect(unlinkGuardian(secretary, link.id)).rejects.toThrow("lastGuardian");
  });

  it("refuse une classe pleine", async () => {
    await secretary.db.class.update({ where: { id: class5 }, data: { capacity: 1 } });
    await expect(
      createStudent(secretary, {
        ...identity,
        classId: class5,
        guardians: [{ firstName: "P", lastName: "P", phone: uniquePhone(), relationship: "MOTHER" }],
      }),
    ).rejects.toThrow("classFull");
    await secretary.db.class.update({ where: { id: class5 }, data: { capacity: 45 } });
  });
});

describe("périmètre du professeur", () => {
  it("ne liste que les élèves de ses classes", async () => {
    const { items, total } = await listStudents(teacher, {});
    expect(total).toBe(teacher.scope.studentIds.size);
    expect(items.every((s) => teacher.scope.studentIds.has(s.id))).toBe(true);
  });

  it("n'ouvre pas la fiche d'un élève d'une autre classe", async () => {
    // Le professeur d'anglais n'enseigne pas en 5e année.
    const english = await secretary.db.staff.findFirstOrThrow({ where: { lastName: "Mensah" } });
    const englishTeacher = await contextFor("les-etoiles", { id: english.userId! }, "TEACHER");
    const other = await secretary.db.enrollment.findFirstOrThrow({ where: { classId: class5 } });
    expect(englishTeacher.scope.classIds.has(class5)).toBe(false);
    await expect(getStudent(englishTeacher, other.studentId)).rejects.toThrow(ForbiddenError);
    const own = [...englishTeacher.scope.studentIds][0];
    await expect(getStudent(englishTeacher, own)).resolves.toMatchObject({ id: own });
  });
});

describe("parcours de l'élève", () => {
  it("une exclusion met à jour l'inscription et est tracée", async () => {
    const enrollment = await secretary.db.enrollment.findFirstOrThrow({ where: { classId: class7, status: "ACTIVE" } });
    await changeStudentStatus(secretary, {
      studentId: enrollment.studentId,
      status: "EXPELLED",
      reason: "Conseil de discipline",
    });
    const updated = await secretary.db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(updated.status).toBe("EXPELLED");
    const log = await secretary.db.auditLog.findFirst({
      where: { entityId: enrollment.studentId, action: "student.status" },
    });
    expect(log?.after).toMatchObject({ status: "EXPELLED" });
    await changeStudentStatus(secretary, { studentId: enrollment.studentId, status: "ACTIVE" });
  });

  it("pas de compte élève en 5e année ; compte par matricule en 7e", async () => {
    const young = await secretary.db.enrollment.findFirstOrThrow({ where: { classId: class5 } });
    await expect(enableStudentAccount(secretary, young.studentId)).rejects.toThrow(DomainError);

    const student = await createStudent(secretary, {
      ...identity,
      firstName: "Compte",
      classId: class7,
      guardians: [{ firstName: "P", lastName: "P", phone: uniquePhone(), relationship: "MOTHER" }],
      sendAccess: false,
    });
    const result = await enableStudentAccount(secretary, student.id);
    expect(result.username).toBe(student.matricule.toLowerCase());
    const reloaded = await secretary.db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(reloaded.accountEnabled).toBe(true);
  });
});
