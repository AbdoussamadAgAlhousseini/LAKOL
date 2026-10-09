import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { submitPreRegistration } from "@/server/platform/preregistration";
import type { ServiceContext } from "@/server/services/context";
import { importStudents, readSpreadsheet, validateImport } from "@/server/services/import";
import { acceptPreRegistration } from "@/server/services/preregistrations";
import { createStaff, setStaffRoles } from "@/server/services/staff";
import { addAssignment, createYear, deleteClass, saveClass, splitPeriods } from "@/server/services/structure";
import { contextFor, uniquePhone } from "./helpers";

let director: ServiceContext;

beforeAll(async () => {
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
});

afterAll(() => prisma.$disconnect());

describe("structure", () => {
  it("découpe l'année en trimestres consécutifs", () => {
    const periods = splitPeriods(new Date("2026-10-01"), new Date("2027-06-30"), 3);
    expect(periods).toHaveLength(3);
    expect(periods[0].from.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(periods[2].to.toISOString().slice(0, 10)).toBe("2027-06-30");
    expect(periods[1].from > periods[0].to).toBe(true);
  });

  it("crée une année avec ses trimestres (non active)", async () => {
    const year = await createYear(director, {
      name: `2026-2027-${Date.now()}`,
      startDate: new Date("2026-10-01"),
      endDate: new Date("2027-06-30"),
    });
    expect(year.isActive).toBe(false);
    expect(await director.db.term.count({ where: { academicYearId: year.id } })).toBe(3);
  });

  it("le professeur principal reçoit le rôle automatiquement ; une classe utilisée ne se supprime pas", async () => {
    const level = await director.db.level.findFirstOrThrow({ where: { name: "7e année" } });
    const teacher = await director.db.staff.findFirstOrThrow({ where: { lastName: "Mensah" } });
    const cls = await saveClass(director, { name: `7e B ${Date.now()}`, levelId: level.id, headTeacherId: teacher.id });
    const roles = await director.db.userRole.findMany({ where: { userId: teacher.userId! }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toContain("HEAD_TEACHER");

    const subject = await director.db.subject.findFirstOrThrow({ where: { code: "ANG" } });
    await addAssignment(director, { classId: cls.id, subjectId: subject.id, staffId: teacher.id });
    await expect(
      addAssignment(director, { classId: cls.id, subjectId: subject.id, staffId: teacher.id }),
    ).rejects.toThrow("subjectAlreadyAssigned");

    const used = await director.db.class.findFirstOrThrow({ where: { name: "7e A" } });
    await expect(deleteClass(director, used.id)).rejects.toThrow("inUse");

    await deleteClass(director, cls.id);
    const after = await director.db.userRole.findMany({ where: { userId: teacher.userId! }, include: { role: true } });
    expect(after.map((r) => r.role.key)).not.toContain("HEAD_TEACHER");
  });
});

describe("personnel", () => {
  it("crée un compte pour un nouveau membre et gère ses rôles", async () => {
    const phone = uniquePhone();
    const staff = await createStaff(director, {
      firstName: "Nouhoum",
      lastName: "Bah",
      phone,
      position: "Surveillant",
      contractType: "PERMANENT",
      roles: ["CENSOR"],
    });
    expect(staff.userId).toBeTruthy();
    await setStaffRoles(director, { staffId: staff.id, roles: ["CENSOR", "TEACHER"] });
    const roles = await director.db.userRole.findMany({ where: { userId: staff.userId! }, include: { role: true } });
    expect(roles.map((r) => r.role.key).sort()).toEqual(["CENSOR", "TEACHER"]);
  });

  it("le directeur ne peut pas se retirer son propre rôle", async () => {
    const self = await director.db.staff.findFirstOrThrow({ where: { userId: director.user.id } });
    await expect(setStaffRoles(director, { staffId: self.id, roles: ["TEACHER"] })).rejects.toThrow(
      "cannotRemoveOwnDirector",
    );
  });
});

describe("import Excel / CSV", () => {
  it("signale les erreurs ligne par ligne et n'importe rien tant qu'il en reste", async () => {
    const csv = [
      "Nom;Prénom;Sexe;Date naissance;Lieu naissance;Classe;Parent nom;Parent prénom;Parent téléphone;Parent email;Lien",
      `Diallo;Ousmane;M;03/02/2013;Kati;7e A;Diallo;Amadou;${uniquePhone()};;Père`,
      "Keïta;;F;31/02/2013;;8e Z;;;123;;Mère",
    ].join("\n");
    const records = await readSpreadsheet(Buffer.from(csv), "eleves.csv");
    const rows = await validateImport(director, records);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toEqual(
      expect.arrayContaining(["missing:prenom", "invalid:date_naissance", "unknownClass", "invalid:parent_telephone"]),
    );
    await expect(importStudents(director, rows, { sendAccess: false })).rejects.toThrow("importHasErrors");

    const result = await importStudents(director, [rows[0]], { sendAccess: false });
    expect(result.created).toBe(1);
    const again = await validateImport(director, records.slice(0, 1));
    expect(again[0].errors).toContain("duplicate");
  });
});

describe("pré-inscription", () => {
  it("un parent pré-inscrit son enfant, l'école valide dans une classe du bon niveau", async () => {
    const level = await director.db.level.findFirstOrThrow({ where: { name: "9e année" } });
    const pre = await submitPreRegistration(
      "les-etoiles",
      {
        levelId: level.id,
        firstName: "Kadidia",
        lastName: "Sangaré",
        gender: "FEMALE",
        guardianFirstName: "Mahamadou",
        guardianLastName: "Sangaré",
        guardianPhone: uniquePhone(),
        guardianRelation: "FATHER",
      },
      `test-${Date.now()}`,
    );
    const wrong = await director.db.class.findFirstOrThrow({ where: { name: "7e A" } });
    await expect(acceptPreRegistration(director, { id: pre.id, classId: wrong.id })).rejects.toThrow("levelMismatch");

    const right = await director.db.class.findFirstOrThrow({ where: { name: "9e A" } });
    const student = await acceptPreRegistration(director, { id: pre.id, classId: right.id });
    const updated = await director.db.preRegistration.findUniqueOrThrow({ where: { id: pre.id } });
    expect(updated.status).toBe("ACCEPTED");
    expect(updated.studentId).toBe(student.id);
  });
});
