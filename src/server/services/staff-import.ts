import "server-only";
import ExcelJS from "exceljs";
import type { ContractType, Gender } from "@prisma/client";
import { normalizePhone } from "@/lib/phone";
import { DomainError } from "@/server/errors";
import type { ServiceContext } from "./context";
import { classMatcher, MAX_IMPORT_ROWS, normalizeHeader, parseDate, parseGender } from "./import";
import { createStaff, STAFF_ROLES, type StaffRole } from "./staff";
import { addAssignment, requireActiveYear } from "./structure";

export const STAFF_IMPORT_COLUMNS = [
  "nom",
  "prenom",
  "sexe",
  "telephone",
  "email",
  "fonction",
  "contrat",
  "date_embauche",
  "salaire_mensuel",
  "taux_horaire",
  "roles",
  "matieres",
  "classes",
  "diplomes",
] as const;
type Column = (typeof STAFF_IMPORT_COLUMNS)[number];

/** Noms de rôles acceptés dans le fichier (sans accents ni majuscules). */
const ROLE_ALIASES: Record<string, StaffRole> = {
  directeur: "DIRECTOR",
  directrice: "DIRECTOR",
  promoteur: "DIRECTOR",
  direction: "DIRECTOR",
  administration: "ADMIN",
  secretariat: "ADMIN",
  secretaire: "ADMIN",
  censeur: "CENSOR",
  surveillant: "CENSOR",
  surveillant_general: "CENSOR",
  comptable: "ACCOUNTANT",
  caissier: "ACCOUNTANT",
  caissiere: "ACCOUNTANT",
  professeur: "TEACHER",
  prof: "TEACHER",
  enseignant: "TEACHER",
  enseignante: "TEACHER",
  bibliothecaire: "LIBRARIAN",
  infirmier: "NURSE",
  infirmiere: "NURSE",
  chauffeur: "DRIVER",
};

export interface StaffImportRow {
  line: number;
  values: Partial<Record<Column, string>>;
  errors: string[];
  parsed?: {
    firstName: string;
    lastName: string;
    gender: Gender | null;
    phone: string | null;
    email: string | null;
    position: string;
    contractType: ContractType;
    hireDate: Date | null;
    monthlySalary: number | null;
    hourlyRate: number | null;
    diplomas: string | null;
    roles: StaffRole[];
    assignments: { classId: string; subjectId: string }[];
  };
}

const list = (v: string) =>
  v
    .split(/[,;/]/)
    .map((x) => x.trim())
    .filter(Boolean);

function parseAmount(v: string): number | null | "invalid" {
  if (!v) return null;
  const n = Number(v.replace(/[\s.  ]/g, "").replace(/f?cfa|xof/i, ""));
  return Number.isInteger(n) && n >= 0 ? n : "invalid";
}

/** Vérifie chaque ligne sans rien écrire : erreurs listées par ligne. */
export async function validateStaffImport(
  ctx: ServiceContext,
  records: Record<string, string>[],
): Promise<StaffImportRow[]> {
  if (records.length > MAX_IMPORT_ROWS) throw new DomainError("tooManyRows");
  const year = await requireActiveYear(ctx);
  const [classes, subjects, staff, taken] = await Promise.all([
    ctx.db.class.findMany({ where: { academicYearId: year.id }, select: { id: true, name: true } }),
    ctx.db.subject.findMany({ select: { id: true, code: true, name: true } }),
    ctx.db.staff.findMany({ where: { deletedAt: null }, select: { phone: true, email: true } }),
    ctx.db.teachingAssignment.findMany({
      where: { academicYearId: year.id },
      select: { classId: true, subjectId: true },
    }),
  ]);
  const findClass = classMatcher(classes);
  const subjectBy = new Map<string, string>();
  for (const s of subjects) {
    subjectBy.set(normalizeHeader(s.code), s.id);
    subjectBy.set(normalizeHeader(s.name), s.id);
  }
  const contacts = new Set(staff.flatMap((s) => [s.phone, s.email?.toLowerCase()]).filter(Boolean) as string[]);
  const assigned = new Set(taken.map((a) => `${a.classId}|${a.subjectId}`));
  const canGrant = ctx.scope.permissions.has("user.manage");
  const canGrantDirector = ctx.scope.permissions.has("role.manage");

  return records.map((record, i) => {
    const values = Object.fromEntries(STAFF_IMPORT_COLUMNS.map((c) => [c, record[c]?.trim() ?? ""])) as Record<
      Column,
      string
    >;
    const errors: string[] = [];
    for (const c of ["nom", "prenom", "fonction"] as const) if (!values[c]) errors.push(`missing:${c}`);

    const gender = values.sexe ? parseGender(values.sexe) : null;
    if (values.sexe && !gender) errors.push("invalid:sexe");
    const phone = values.telephone ? normalizePhone(values.telephone, ctx.school.country) : null;
    if (values.telephone && !phone) errors.push("invalid:telephone");
    const email = values.email.toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid:email");
    if ((phone && contacts.has(phone)) || (email && contacts.has(email))) errors.push("duplicateStaff");
    if (phone) contacts.add(phone);
    if (email) contacts.add(email);

    const contract = normalizeHeader(values.contrat);
    const contractType: ContractType | null =
      !contract || contract.startsWith("perm")
        ? "PERMANENT"
        : contract.startsWith("vac") || contract.startsWith("horaire")
          ? "HOURLY"
          : null;
    if (!contractType) errors.push("invalid:contrat");
    const hireDate = parseDate(values.date_embauche);
    if (hireDate === "invalid") errors.push("invalid:date_embauche");
    const monthlySalary = parseAmount(values.salaire_mensuel);
    if (monthlySalary === "invalid") errors.push("invalid:salaire_mensuel");
    const hourlyRate = parseAmount(values.taux_horaire);
    if (hourlyRate === "invalid") errors.push("invalid:taux_horaire");

    const roles = new Set<StaffRole>();
    for (const r of list(values.roles)) {
      const role = ROLE_ALIASES[normalizeHeader(r)] ?? STAFF_ROLES.find((k) => k === r.toUpperCase());
      if (role) roles.add(role);
      else errors.push(`invalidRole:${r}`);
    }

    const subjectIds: string[] = [];
    for (const m of list(values.matieres)) {
      const id = subjectBy.get(normalizeHeader(m));
      if (id) subjectIds.push(id);
      else errors.push(`unknownSubject:${m}`);
    }
    const classIds: string[] = [];
    for (const c of list(values.classes)) {
      const id = findClass(c);
      if (id) classIds.push(id);
      else errors.push(`unknownClass:${c}`);
    }
    if ((values.matieres === "") !== (values.classes === "")) errors.push("assignmentNeedsBoth");
    // Une matière enseignée dans une classe donne le rôle de professeur.
    if (subjectIds.length > 0) roles.add("TEACHER");

    const assignments = classIds.flatMap((classId) => subjectIds.map((subjectId) => ({ classId, subjectId })));
    for (const a of assignments) {
      const key = `${a.classId}|${a.subjectId}`;
      if (assigned.has(key)) {
        const cls = classes.find((c) => c.id === a.classId)!.name;
        const sub = subjects.find((s) => s.id === a.subjectId)!.code;
        errors.push(`alreadyAssigned:${sub} ${cls}`);
      }
      assigned.add(key);
    }

    if (roles.size > 0 && !phone && !email) errors.push("contactRequired");
    if (roles.size > 0 && !canGrant) errors.push("rolesForbidden");
    if (roles.has("DIRECTOR") && !canGrantDirector) errors.push("rolesForbidden");

    const row: StaffImportRow = { line: i + 2, values, errors };
    if (errors.length === 0) {
      row.parsed = {
        firstName: values.prenom,
        lastName: values.nom,
        gender,
        phone,
        email,
        position: values.fonction,
        contractType: contractType!,
        hireDate: hireDate === "invalid" ? null : hireDate,
        monthlySalary: monthlySalary === "invalid" ? null : monthlySalary,
        hourlyRate: hourlyRate === "invalid" ? null : hourlyRate,
        diplomas: list(values.diplomes).join("\n") || null,
        roles: [...roles],
        assignments,
      };
    }
    return row;
  });
}

/** Crée le personnel, ses comptes et ses affectations (seulement si aucune ligne n'est en erreur). */
export async function importStaff(ctx: ServiceContext, rows: StaffImportRow[], options: { sendAccess: boolean }) {
  if (rows.some((r) => r.errors.length > 0)) throw new DomainError("importHasErrors");
  let created = 0;
  for (const row of rows) {
    const { assignments, ...p } = row.parsed!;
    const staff = await createStaff(ctx, { ...p, sendAccess: options.sendAccess });
    for (const a of assignments) await addAssignment(ctx, { ...a, staffId: staff.id });
    created += 1;
  }
  return { created };
}

/** Modèle Excel à remplir, avec les classes et matières de l'école. */
export async function buildStaffImportTemplate(ctx: ServiceContext): Promise<Buffer> {
  const year = await requireActiveYear(ctx);
  const [classes, subjects] = await Promise.all([
    ctx.db.class.findMany({ where: { academicYearId: year.id }, orderBy: { name: "asc" } }),
    ctx.db.subject.findMany({ orderBy: { name: "asc" } }),
  ]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Personnel");
  sheet.addRow([...STAFF_IMPORT_COLUMNS]);
  sheet.addRow([
    "Coulibaly",
    "Mamadou",
    "M",
    "76 12 34 56",
    "",
    "Professeur de mathématiques",
    "Permanent",
    "01/10/2024",
    "150000",
    "",
    "Professeur",
    subjects[0]?.code ?? "MATH",
    classes[0]?.name ?? "7e année A",
    "Licence de mathématiques",
  ]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 18));
  const ref = workbook.addWorksheet("Classes et matières");
  ref.addRow(["Classes", "Matières (code)", "Matières (nom)", "Rôles"]);
  const roles = [
    "Directeur",
    "Administration",
    "Censeur",
    "Comptable",
    "Professeur",
    "Bibliothécaire",
    "Infirmier",
    "Chauffeur",
  ];
  for (let i = 0; i < Math.max(classes.length, subjects.length, roles.length); i++) {
    ref.addRow([classes[i]?.name ?? "", subjects[i]?.code ?? "", subjects[i]?.name ?? "", roles[i] ?? ""]);
  }
  ref.getRow(1).font = { bold: true };
  ref.columns.forEach((c) => (c.width = 22));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
