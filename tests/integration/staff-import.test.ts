import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import type { ServiceContext } from "@/server/services/context";
import { importStaff, validateStaffImport } from "@/server/services/staff-import";
import { contextFor } from "./helpers";

let director: ServiceContext;

beforeAll(async () => {
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
});

afterAll(() => prisma.$disconnect());

const row = (r: Record<string, string>) => ({
  nom: "",
  prenom: "",
  sexe: "",
  telephone: "",
  email: "",
  fonction: "",
  contrat: "",
  date_embauche: "",
  salaire_mensuel: "",
  taux_horaire: "",
  roles: "",
  matieres: "",
  classes: "",
  diplomes: "",
  ...r,
});

describe("import du personnel", () => {
  it("vérifie chaque ligne puis crée le personnel, ses comptes et ses affectations", async () => {
    const year = await director.db.academicYear.findFirstOrThrow({ where: { isActive: true } });
    const [classes, subjects, taken] = await Promise.all([
      director.db.class.findMany({ where: { academicYearId: year.id } }),
      director.db.subject.findMany(),
      director.db.teachingAssignment.findMany({
        where: { academicYearId: year.id },
        include: { class: true, subject: true },
      }),
    ]);
    const used = new Set(taken.map((a) => `${a.classId}|${a.subjectId}`));
    const free = classes
      .flatMap((c) => subjects.map((s) => ({ c, s })))
      .find(({ c, s }) => !used.has(`${c.id}|${s.id}`))!;
    const busy = taken[0];

    const rows = await validateStaffImport(director, [
      row({
        nom: "Sow",
        prenom: "Aïssata",
        sexe: "F",
        telephone: "76 55 00 01",
        fonction: "Professeure",
        contrat: "Vacataire",
        taux_horaire: "2 500",
        roles: "Professeur",
        matieres: free.s.code,
        classes: free.c.name,
      }),
      row({
        nom: "Kané",
        prenom: "Ali",
        email: "ali.kane@exemple.ml",
        fonction: "Caissier",
        salaire_mensuel: "90000",
        roles: "Comptable",
      }),
      row({
        nom: "X",
        prenom: "Y",
        telephone: "70 00 00 20",
        fonction: "Prof",
        roles: "Pilote",
        matieres: "Latin",
        classes: "7e Z",
      }),
      row({
        nom: "Z",
        prenom: "W",
        telephone: "76 55 00 02",
        fonction: "Prof",
        matieres: busy.subject.code,
        classes: busy.class.name,
      }),
      row({ nom: "V", prenom: "U", fonction: "Prof", matieres: free.s.code }),
    ]);

    expect(rows[0].errors).toEqual([]);
    expect(rows[0].parsed).toMatchObject({ contractType: "HOURLY", hourlyRate: 2500, roles: ["TEACHER"] });
    expect(rows[1].errors).toEqual([]);
    expect(rows[2].errors).toEqual(
      expect.arrayContaining(["duplicateStaff", "invalidRole:Pilote", "unknownSubject:Latin", "unknownClass:7e Z"]),
    );
    expect(rows[3].errors).toEqual([`alreadyAssigned:${busy.subject.code} ${busy.class.name}`]);
    expect(rows[4].errors).toEqual(expect.arrayContaining(["assignmentNeedsBoth", "contactRequired"]));

    await expect(importStaff(director, rows, { sendAccess: false })).rejects.toThrow("importHasErrors");
    expect(await importStaff(director, rows.slice(0, 2), { sendAccess: false })).toEqual({ created: 2 });

    const sow = await director.db.staff.findFirstOrThrow({
      where: { lastName: "Sow" },
      include: { teachingAssignments: true },
    });
    expect(sow.teachingAssignments).toMatchObject([{ classId: free.c.id, subjectId: free.s.id }]);
    const roles = await director.db.userRole.findMany({ where: { userId: sow.userId! }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toContain("TEACHER");
    const kane = await director.db.staff.findFirstOrThrow({ where: { lastName: "Kané" } });
    expect(kane.monthlySalary).toBe(90000);
  });
});
