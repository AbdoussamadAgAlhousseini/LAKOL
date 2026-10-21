import "server-only";
import { assertStudentCapacity } from "@/server/platform/subscriptions";
import ExcelJS from "exceljs";
import type { Gender, GuardianRelationship } from "@prisma/client";
import { normalizePhone } from "@/lib/phone";
import { DomainError } from "@/server/errors";
import type { ServiceContext } from "./context";
import { requireActiveYear } from "./structure";
import { createStudent } from "./students";

export const IMPORT_COLUMNS = [
  "nom",
  "prenom",
  "sexe",
  "date_naissance",
  "lieu_naissance",
  "classe",
  "parent_nom",
  "parent_prenom",
  "parent_telephone",
  "parent_email",
  "lien",
] as const;
type Column = (typeof IMPORT_COLUMNS)[number];
export const MAX_IMPORT_ROWS = 1000;

export interface ImportRow {
  line: number;
  values: Partial<Record<Column, string>>;
  errors: string[];
  parsed?: {
    firstName: string;
    lastName: string;
    gender: Gender;
    birthDate: Date | null;
    birthPlace: string | null;
    classId: string;
    guardian: {
      firstName: string;
      lastName: string;
      phone: string;
      email: string | null;
      relationship: GuardianRelationship;
    };
  };
}

function normalizeHeader(h: string) {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
  }
  return String(value).trim();
}

/** Lit un fichier .xlsx ou .csv (séparateur « ; » ou « , ») en lignes clé/valeur. */
export async function readSpreadsheet(buffer: Buffer, filename: string): Promise<Record<string, string>[]> {
  let rows: string[][];
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = buffer.toString("utf8").replace(/^﻿/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    const sep = (lines[0]?.match(/;/g)?.length ?? 0) >= (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
    rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1")));
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) values.push(cellText(row.getCell(c).value));
      rows.push(values);
    });
  }
  const [header, ...data] = rows;
  if (!header) return [];
  const keys = header.map(normalizeHeader);
  return data
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

function parseGender(v: string): Gender | null {
  const s = normalizeHeader(v);
  if (["m", "g", "masculin", "garcon", "male", "homme"].includes(s)) return "MALE";
  if (["f", "feminin", "fille", "female", "femme"].includes(s)) return "FEMALE";
  return null;
}

function parseRelationship(v: string): GuardianRelationship {
  const s = normalizeHeader(v);
  if (s.startsWith("pere") || s === "father") return "FATHER";
  if (s.startsWith("mere") || s === "mother") return "MOTHER";
  if (s.startsWith("tuteur") || s === "guardian") return "LEGAL_GUARDIAN";
  return s ? "OTHER" : "LEGAL_GUARDIAN";
}

/** Accepte JJ/MM/AAAA, AAAA-MM-JJ ou une date Excel. */
export function parseDate(v: string): Date | null | "invalid" {
  if (!v) return null;
  let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  return "invalid";
}

function validDate(y: number, mo: number, d: number): Date | "invalid" {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y > 1950 ? date : "invalid";
}

/** Forme courte d'un nom de classe : « 7e année A », « 7ème A » et « 7e A » donnent « 7a ». */
export function classKey(name: string) {
  return normalizeHeader(name)
    .replace(/annee/g, "")
    .replace(/(\d+)(?:eme|ere|re|er|e)(?=_|$)/g, "$1")
    .replace(/_/g, "");
}

/** Retrouve une classe par son nom exact, sinon par sa forme courte si elle est sans ambiguïté. */
function classMatcher(classes: { id: string; name: string }[]) {
  const exact = new Map(classes.map((c) => [normalizeHeader(c.name), c.id]));
  const loose = new Map<string, string | null>();
  for (const c of classes) {
    const k = classKey(c.name);
    loose.set(k, loose.has(k) ? null : c.id);
  }
  return (name: string) => exact.get(normalizeHeader(name)) ?? loose.get(classKey(name)) ?? undefined;
}

/** Vérifie chaque ligne sans rien écrire : erreurs listées par ligne. */
export async function validateImport(ctx: ServiceContext, records: Record<string, string>[]): Promise<ImportRow[]> {
  if (records.length > MAX_IMPORT_ROWS) throw new DomainError("tooManyRows");
  const year = await requireActiveYear(ctx);
  const classes = await ctx.db.class.findMany({ where: { academicYearId: year.id } });
  const findClass = classMatcher(classes);
  const existing = await ctx.db.student.findMany({
    where: { deletedAt: null },
    select: { firstName: true, lastName: true, birthDate: true },
  });
  const key = (f: string, l: string, d: Date | null) =>
    `${normalizeHeader(f)}|${normalizeHeader(l)}|${d?.toISOString().slice(0, 10) ?? ""}`;
  const seen = new Set(existing.map((s) => key(s.firstName, s.lastName, s.birthDate)));

  return records.map((record, i) => {
    const values = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, record[c]?.trim() ?? ""])) as Record<
      Column,
      string
    >;
    const errors: string[] = [];
    const require = (c: Column) => {
      if (!values[c]) errors.push(`missing:${c}`);
    };
    (["nom", "prenom", "sexe", "classe", "parent_telephone"] as const).forEach(require);

    const gender = values.sexe ? parseGender(values.sexe) : null;
    if (values.sexe && !gender) errors.push("invalid:sexe");
    const birthDate = parseDate(values.date_naissance);
    if (birthDate === "invalid") errors.push("invalid:date_naissance");
    const classId = values.classe ? findClass(values.classe) : undefined;
    if (values.classe && !classId) errors.push("unknownClass");
    const phone = values.parent_telephone ? normalizePhone(values.parent_telephone, ctx.school.country) : null;
    if (values.parent_telephone && !phone) errors.push("invalid:parent_telephone");
    const email = values.parent_email.toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid:parent_email");

    const date = birthDate === "invalid" ? null : birthDate;
    const k = key(values.prenom, values.nom, date);
    if (values.nom && values.prenom) {
      if (seen.has(k)) errors.push("duplicate");
      seen.add(k);
    }

    const row: ImportRow = { line: i + 2, values, errors };
    if (errors.length === 0) {
      row.parsed = {
        firstName: values.prenom,
        lastName: values.nom,
        gender: gender!,
        birthDate: date,
        birthPlace: values.lieu_naissance || null,
        classId: classId!,
        guardian: {
          firstName: values.parent_prenom || "Parent",
          lastName: values.parent_nom || values.nom,
          phone: phone!,
          email,
          relationship: parseRelationship(values.lien),
        },
      };
    }
    return row;
  });
}

/** Importe les lignes valides (toutes ou rien si une ligne est en erreur). */
export async function importStudents(ctx: ServiceContext, rows: ImportRow[], options: { sendAccess: boolean }) {
  if (rows.some((r) => r.errors.length > 0)) throw new DomainError("importHasErrors");
  // Tout ou rien : un import ne doit pas s'arrêter au milieu parce que la formule est pleine.
  await assertStudentCapacity(ctx.school.id, rows.length);
  let created = 0;
  for (const row of rows) {
    const p = row.parsed!;
    await createStudent(ctx, {
      firstName: p.firstName,
      lastName: p.lastName,
      gender: p.gender,
      birthDate: p.birthDate,
      birthPlace: p.birthPlace,
      classId: p.classId,
      guardians: [{ ...p.guardian, isPrimary: true }],
      sendAccess: options.sendAccess,
    });
    created += 1;
  }
  return { created };
}

/** Modèle Excel à remplir, avec la liste des classes de l'année active. */
export async function buildImportTemplate(ctx: ServiceContext): Promise<Buffer> {
  const year = await requireActiveYear(ctx);
  const classes = await ctx.db.class.findMany({ where: { academicYearId: year.id }, orderBy: { name: "asc" } });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Élèves");
  sheet.addRow([...IMPORT_COLUMNS]);
  sheet.addRow([
    "Traoré",
    "Awa",
    "F",
    "12/03/2014",
    "Bamako",
    classes[0]?.name ?? "7e A",
    "Traoré",
    "Boubacar",
    "70 12 34 56",
    "",
    "Père",
  ]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 18));
  const list = workbook.addWorksheet("Classes");
  list.addRow(["Classes disponibles"]);
  classes.forEach((c) => list.addRow([c.name]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
