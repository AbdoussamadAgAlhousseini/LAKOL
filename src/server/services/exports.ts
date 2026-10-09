import "server-only";
import ExcelJS from "exceljs";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { addDays, dayStart } from "@/lib/time";
import type { ServiceContext } from "./context";
import { computeClassResults } from "./assessments";
import { listDebtors } from "./finance/reports";
import { found, requireActiveYear } from "./structure";

type Cell = string | number | Date | null;
interface Column {
  header: string;
  width?: number;
  /** Format Excel (ex. « #,##0 » pour les montants, « dd/mm/yyyy » pour les dates). */
  numFmt?: string;
}

/** Classeur d'une feuille : en-tête en gras, première ligne figée, filtres automatiques. */
async function workbook(sheetName: string, columns: Column[], rows: Cell[][]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LAKOL";
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    width: c.width ?? 16,
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const MONEY = "#,##0";
const DATE = "dd/mm/yyyy";

export type ExportKind = "students" | "debtors" | "payments" | "attendance" | "class-results";

/** Liste des élèves inscrits (année active), par classe. */
async function studentsExport(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "student.read")) throw new ForbiddenError();
  const year = await requireActiveYear(ctx);
  const enrollments = await ctx.db.enrollment.findMany({
    where: { academicYearId: year.id, status: "ACTIVE", deletedAt: null },
    include: {
      class: true,
      student: { include: { guardians: { where: { isPrimary: true }, include: { guardian: true } } } },
    },
    orderBy: [{ class: { name: "asc" } }, { student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  });
  return {
    name: `eleves-${year.name}`,
    buffer: await workbook(
      "Élèves",
      [
        { header: "Matricule", width: 14 },
        { header: "Nom", width: 18 },
        { header: "Prénom", width: 18 },
        { header: "Sexe", width: 6 },
        { header: "Date de naissance", width: 14, numFmt: DATE },
        { header: "Classe", width: 10 },
        { header: "Tuteur principal", width: 24 },
        { header: "Téléphone", width: 16 },
      ],
      enrollments.map((e) => {
        const g = e.student.guardians[0]?.guardian;
        return [
          e.student.matricule,
          e.student.lastName,
          e.student.firstName,
          e.student.gender === "FEMALE" ? "F" : "M",
          e.student.birthDate,
          e.class.name,
          g ? `${g.firstName} ${g.lastName}` : null,
          g?.phone ?? null,
        ];
      }),
    ),
  };
}

async function debtorsExport(ctx: ServiceContext) {
  const { items } = await listDebtorsAll(ctx);
  return {
    name: "impayes",
    buffer: await workbook(
      "Impayés",
      [
        { header: "Matricule", width: 14 },
        { header: "Élève", width: 26 },
        { header: "Classe", width: 10 },
        { header: "Montant dû", width: 14, numFmt: MONEY },
        { header: "Tuteur principal", width: 24 },
        { header: "Téléphone", width: 16 },
        { header: "Dernière relance", width: 14, numFmt: DATE },
      ],
      items.map((d) => {
        const g = d.student.guardians[0]?.guardian;
        return [
          d.student.matricule,
          `${d.student.lastName} ${d.student.firstName}`,
          d.student.enrollments[0]?.class.name ?? null,
          d.amount,
          g ? `${g.firstName} ${g.lastName}` : null,
          g?.phone ?? null,
          d.lastReminderAt,
        ];
      }),
    ),
  };
}

/** Toutes les pages de la liste des impayés. */
async function listDebtorsAll(ctx: ServiceContext) {
  const items: Awaited<ReturnType<typeof listDebtors>>["items"] = [];
  for (let page = 1; ; page++) {
    const res = await listDebtors(ctx, { page });
    items.push(...res.items);
    if (items.length >= res.total || res.items.length === 0) return { ...res, items };
  }
}

/** Journal des paiements d'une période (par défaut : le mois en cours). */
async function paymentsExport(ctx: ServiceContext, from: Date, to: Date) {
  if (!canAll(ctx.scope, "finance.read")) throw new ForbiddenError();
  const payments = await ctx.db.payment.findMany({
    where: { deletedAt: null, paidAt: { gte: from, lt: to } },
    include: { student: true, receipt: true },
    orderBy: { paidAt: "asc" },
  });
  const METHODS: Record<string, string> = {
    CASH: "Espèces",
    CHEQUE: "Chèque",
    TRANSFER: "Virement",
    MOBILE_MONEY: "Mobile money",
  };
  return {
    name: `paiements-${from.toISOString().slice(0, 10)}`,
    buffer: await workbook(
      "Paiements",
      [
        { header: "Date", width: 12, numFmt: DATE },
        { header: "Reçu", width: 16 },
        { header: "Élève", width: 26 },
        { header: "Mode", width: 12 },
        { header: "Référence", width: 14 },
        { header: "Montant", width: 12, numFmt: MONEY },
        { header: "Statut", width: 10 },
      ],
      payments.map((p) => [
        p.paidAt,
        p.receipt?.number ?? null,
        `${p.student.lastName} ${p.student.firstName}`,
        METHODS[p.method] ?? p.method,
        p.reference,
        p.amount,
        p.status === "CANCELLED" ? "Annulé" : "Validé",
      ]),
    ),
  };
}

/** Assiduité par élève sur une période (absences, retards, justifiées, taux de présence). */
async function attendanceExport(ctx: ServiceContext, from: Date, to: Date) {
  if (!canAll(ctx.scope, "attendance.read")) throw new ForbiddenError();
  const year = await requireActiveYear(ctx);
  const [enrollments, groups] = await Promise.all([
    ctx.db.enrollment.findMany({
      where: { academicYearId: year.id, status: "ACTIVE", deletedAt: null },
      include: { student: true, class: true },
      orderBy: [{ class: { name: "asc" } }, { student: { lastName: "asc" } }],
    }),
    ctx.db.attendance.groupBy({
      by: ["studentId", "status"],
      where: { date: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ]);
  const count = (studentId: string, status: string) =>
    groups.find((g) => g.studentId === studentId && g.status === status)?._count._all ?? 0;
  return {
    name: `assiduite-${from.toISOString().slice(0, 10)}`,
    buffer: await workbook(
      "Assiduité",
      [
        { header: "Classe", width: 10 },
        { header: "Matricule", width: 14 },
        { header: "Élève", width: 26 },
        { header: "Présences", width: 10 },
        { header: "Retards", width: 10 },
        { header: "Absences", width: 10 },
        { header: "Dont justifiées", width: 14 },
        { header: "Taux de présence (%)", width: 18 },
      ],
      enrollments.map((e) => {
        const present = count(e.studentId, "PRESENT");
        const late = count(e.studentId, "LATE");
        const absent = count(e.studentId, "ABSENT");
        const excused = count(e.studentId, "EXCUSED");
        const total = present + late + absent + excused;
        return [
          e.class.name,
          e.student.matricule,
          `${e.student.lastName} ${e.student.firstName}`,
          present,
          late,
          absent + excused,
          excused,
          total ? Math.round(((present + late) / total) * 1000) / 10 : null,
        ];
      }),
    ),
  };
}

/** Résultats d'une classe pour une période : rang, moyenne générale et moyennes par matière. */
async function classResultsExport(ctx: ServiceContext, classId: string, termId: string) {
  const r = await computeClassResults(ctx, { classId, termId });
  const term = await found(ctx.db.term.findUnique({ where: { id: termId } }));
  const note = (v: number | null) => (v === null ? null : v / 100);
  const ranked = [...r.students].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  return {
    name: `resultats-${r.class.name}-${term.name}`.replace(/\s+/g, "-"),
    buffer: await workbook(
      `${r.class.name} ${term.name}`,
      [
        { header: "Rang", width: 6 },
        { header: "Élève", width: 26 },
        { header: `Moyenne /${r.scale}`, width: 12, numFmt: "0.00" },
        ...r.subjects.map((s) => ({ header: `${s.name} (×${s.coefficient})`, width: 14, numFmt: "0.00" })),
      ],
      ranked.map((s) => [
        s.rank,
        `${s.lastName} ${s.firstName}`,
        note(s.average),
        ...r.subjects.map((sub) => note(s.subjects.find((x) => x.subjectId === sub.id)?.average ?? null)),
      ]),
    ),
  };
}

/** Point d'entrée des exports Excel (droits vérifiés par chaque export). */
export async function exportXlsx(
  ctx: ServiceContext,
  kind: ExportKind,
  params: { from?: Date; to?: Date; classId?: string; termId?: string },
) {
  const today = dayStart();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  switch (kind) {
    case "students":
      return studentsExport(ctx);
    case "debtors":
      return debtorsExport(ctx);
    case "payments":
      return paymentsExport(ctx, params.from ?? monthStart, params.to ?? addDays(today, 1));
    case "attendance":
      return attendanceExport(ctx, params.from ?? addDays(today, -30), params.to ?? today);
    case "class-results":
      if (!params.classId || !params.termId) throw new ForbiddenError();
      return classResultsExport(ctx, params.classId, params.termId);
  }
}
