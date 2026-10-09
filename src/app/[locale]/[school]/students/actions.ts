"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import { optionalPhone, phoneOrFail } from "@/server/phone-field";
import { importStudents, readSpreadsheet, validateImport, type ImportRow } from "@/server/services/import";
import { acceptPreRegistration, rejectPreRegistration } from "@/server/services/preregistrations";
import {
  changeClass,
  changeStudentStatus,
  createStudent,
  deleteDocument,
  disableStudentAccount,
  enableStudentAccount,
  linkGuardian,
  reenrollStudent,
  resendGuardianAccess,
  unlinkGuardian,
  updateGuardianLink,
  updateStudent,
  uploadStudentDocument,
} from "@/server/services/students";
import { checkbox, email, file, id, optionalDate, optionalText, text } from "@/lib/zod";

const gender = z.enum(["MALE", "FEMALE"]);
const relationship = z.enum(["FATHER", "MOTHER", "LEGAL_GUARDIAN", "OTHER"]);

const identity = {
  firstName: text(80),
  lastName: text(80),
  gender,
  birthDate: optionalDate,
  birthPlace: optionalText(120),
  nationality: optionalText(80),
  address: optionalText(200),
  bloodGroup: optionalText(5),
  allergies: optionalText(500),
  medicalNotes: optionalText(1000),
  emergencyName: optionalText(120),
  emergencyPhone: optionalText(30),
};

type GuardianFields = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  relationship?: z.infer<typeof relationship>;
};

export const createStudentAction = schoolAction(
  {
    permission: "student.write",
    schema: z.object({
      ...identity,
      classId: id,
      // Champs du formulaire : g1* (parent principal, obligatoire) et g2* (second parent, facultatif).
      g1FirstName: text(80),
      g1LastName: text(80),
      g1Phone: text(30),
      g1Email: email.optional(),
      g1Relationship: relationship,
      g2FirstName: optionalText(80),
      g2LastName: optionalText(80),
      g2Phone: optionalText(30),
      g2Email: email.optional(),
      g2Relationship: relationship.optional(),
      sendAccess: checkbox,
    }),
  },
  async (ctx, input) => {
    const country = ctx.school.country;
    const entries: [string, GuardianFields][] = [
      [
        "g1",
        {
          firstName: input.g1FirstName,
          lastName: input.g1LastName,
          phone: input.g1Phone,
          email: input.g1Email,
          relationship: input.g1Relationship,
        },
      ],
      [
        "g2",
        {
          firstName: input.g2FirstName,
          lastName: input.g2LastName,
          phone: input.g2Phone,
          email: input.g2Email,
          relationship: input.g2Relationship,
        },
      ],
    ];
    const guardians = [];
    for (const [prefix, g] of entries) {
      if (!g.phone) continue;
      if (!g.firstName || !g.lastName || !g.relationship) throw new DomainError("guardianIncomplete", `${prefix}Phone`);
      guardians.push({
        firstName: g.firstName,
        lastName: g.lastName,
        phone: phoneOrFail(g.phone, country, `${prefix}Phone`),
        email: g.email ?? null,
        relationship: g.relationship,
        isPrimary: prefix === "g1",
      });
    }
    const student = await createStudent(ctx, {
      ...input,
      emergencyPhone: optionalPhone(input.emergencyPhone, country, "emergencyPhone"),
      guardians,
    });
    return { id: student.id };
  },
);

export const updateStudentAction = schoolAction(
  { permission: "student.write", schema: z.object({ id, ...identity }) },
  async (ctx, { id: studentId, ...input }) => {
    await updateStudent(ctx, studentId, {
      ...input,
      emergencyPhone: optionalPhone(input.emergencyPhone, ctx.school.country, "emergencyPhone"),
    });
    return { id: studentId };
  },
);

export const linkGuardianAction = schoolAction(
  {
    permission: "guardian.write",
    schema: z.object({
      studentId: id,
      firstName: text(80),
      lastName: text(80),
      phone: text(30),
      email: email.optional(),
      profession: optionalText(80),
      relationship,
      isPrimary: checkbox,
    }),
  },
  async (ctx, { studentId, ...g }) => {
    await linkGuardian(ctx, studentId, { ...g, phone: phoneOrFail(g.phone, ctx.school.country, "phone") });
  },
);

export const updateGuardianLinkAction = schoolAction(
  {
    permission: "guardian.write",
    schema: z.object({
      linkId: id,
      relationship,
      isPrimary: checkbox,
      canViewGrades: checkbox,
      canViewFinance: checkbox,
      receivesNotifications: checkbox,
    }),
  },
  async (ctx, input) => updateGuardianLink(ctx, input),
);

export const unlinkGuardianAction = schoolAction(
  { permission: "guardian.write", schema: z.object({ linkId: id }) },
  async (ctx, { linkId }) => unlinkGuardian(ctx, linkId),
);

export const resendGuardianAccessAction = schoolAction(
  { permission: "guardian.write", schema: z.object({ guardianId: id }) },
  async (ctx, { guardianId }) => resendGuardianAccess(ctx, guardianId),
);

export const changeClassAction = schoolAction(
  { permission: "student.write", schema: z.object({ studentId: id, classId: id }) },
  async (ctx, input) => changeClass(ctx, input),
);

export const changeStatusAction = schoolAction(
  {
    permission: "student.write",
    schema: z.object({
      studentId: id,
      status: z.enum(["ACTIVE", "TRANSFERRED", "DROPPED", "EXPELLED"]),
      reason: optionalText(500),
    }),
  },
  async (ctx, input) => changeStudentStatus(ctx, input),
);

export const reenrollAction = schoolAction(
  { permission: "student.write", schema: z.object({ studentId: id, classId: id }) },
  async (ctx, input) => reenrollStudent(ctx, input),
);

export const enableAccountAction = schoolAction(
  { permission: "student.write", schema: z.object({ studentId: id }) },
  async (ctx, { studentId }) => enableStudentAccount(ctx, studentId),
);

export const disableAccountAction = schoolAction(
  { permission: "student.write", schema: z.object({ studentId: id }) },
  async (ctx, { studentId }) => disableStudentAccount(ctx, studentId),
);

export const uploadDocumentAction = schoolAction(
  {
    permission: "student.write",
    schema: z.object({
      studentId: id,
      category: z.enum(["PHOTO", "BIRTH_CERTIFICATE", "CERTIFICATE", "MEDICAL", "OTHER"]),
      file,
    }),
  },
  async (ctx, input) => {
    await uploadStudentDocument(ctx, input);
  },
);

export const deleteDocumentAction = schoolAction(
  { permission: "student.write", schema: z.object({ documentId: id }) },
  async (ctx, { documentId }) => deleteDocument(ctx, documentId),
);

// ── Import ─────────────────────────────────────────────────────────────────

const importSchema = z.object({ file, sendAccess: checkbox });

async function readRows(ctx: Parameters<Parameters<typeof schoolAction>[1]>[0], upload: File) {
  if (upload.size > 5 * 1024 * 1024) throw new DomainError("fileTooLarge", "file");
  const records = await readSpreadsheet(Buffer.from(await upload.arrayBuffer()), upload.name);
  if (records.length === 0) throw new DomainError("emptyFile", "file");
  return validateImport(ctx, records);
}

export type ImportPreview = Pick<ImportRow, "line" | "values" | "errors">[];

export const checkImportAction = schoolAction(
  { permission: "student.import", schema: importSchema },
  async (ctx, input) => {
    const rows = await readRows(ctx, input.file);
    return rows.map(({ line, values, errors }) => ({ line, values, errors })) satisfies ImportPreview;
  },
);

export const runImportAction = schoolAction(
  { permission: "student.import", schema: importSchema },
  async (ctx, input) => {
    const rows = await readRows(ctx, input.file);
    return importStudents(ctx, rows, { sendAccess: input.sendAccess });
  },
);

// ── Pré-inscriptions ───────────────────────────────────────────────────────

export const acceptPreRegistrationAction = schoolAction(
  { permission: "student.write", schema: z.object({ id, classId: id }) },
  async (ctx, input) => {
    const student = await acceptPreRegistration(ctx, input);
    return { id: student.id };
  },
);

export const rejectPreRegistrationAction = schoolAction(
  { permission: "student.write", schema: z.object({ id, reason: optionalText(500) }) },
  async (ctx, input) => rejectPreRegistration(ctx, input),
);
