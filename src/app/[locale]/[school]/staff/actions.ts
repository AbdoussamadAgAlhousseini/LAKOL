"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { optionalPhone } from "@/server/phone-field";
import {
  createStaff,
  deactivateStaff,
  reactivateStaff,
  resendStaffAccess,
  setStaffRoles,
  STAFF_ROLES,
  updateStaff,
} from "@/server/services/staff";
import { checkbox, email, file, id, optionalDate, optionalInt, optionalText, text } from "@/lib/zod";
import { DomainError } from "@/server/errors";
import { readSpreadsheet } from "@/server/services/import";
import { importStaff, validateStaffImport } from "@/server/services/staff-import";
import type { ImportPreview } from "@/components/forms/spreadsheet-import-form";

const fields = {
  firstName: text(80),
  lastName: text(80),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  phone: optionalText(30),
  email: email.optional(),
  position: text(80),
  contractType: z.enum(["PERMANENT", "HOURLY"]),
  hireDate: optionalDate,
  monthlySalary: optionalInt(0, 100_000_000),
  hourlyRate: optionalInt(0, 10_000_000),
  diplomas: optionalText(2000),
};
const roles = z.array(z.enum(STAFF_ROLES)).default([]);

export const createStaffAction = schoolAction(
  { permission: "staff.write", schema: z.object({ ...fields, roles, sendAccess: checkbox }) },
  async (ctx, input) => {
    const staff = await createStaff(ctx, { ...input, phone: optionalPhone(input.phone, ctx.school.country, "phone") });
    return { id: staff.id };
  },
);

export const updateStaffAction = schoolAction(
  { permission: "staff.write", schema: z.object({ id, ...fields }) },
  async (ctx, { id: staffId, ...input }) => {
    await updateStaff(ctx, staffId, { ...input, phone: optionalPhone(input.phone, ctx.school.country, "phone") });
  },
);

// Attribuer des rôles donne des accès : réservé à la gestion des utilisateurs.
export const setStaffRolesAction = schoolAction(
  { permission: "user.manage", schema: z.object({ staffId: id, roles }) },
  async (ctx, input) => setStaffRoles(ctx, input),
);

export const deactivateStaffAction = schoolAction(
  { permission: "staff.write", schema: z.object({ staffId: id }) },
  async (ctx, { staffId }) => deactivateStaff(ctx, staffId),
);

export const reactivateStaffAction = schoolAction(
  { permission: "staff.write", schema: z.object({ staffId: id }) },
  async (ctx, { staffId }) => reactivateStaff(ctx, staffId),
);

export const resendStaffAccessAction = schoolAction(
  { permission: "user.manage", schema: z.object({ staffId: id }) },
  async (ctx, { staffId }) => resendStaffAccess(ctx, staffId),
);

// ── Import Excel ───────────────────────────────────────────────────────────

const importSchema = z.object({ file, sendAccess: checkbox });

async function readRows(ctx: Parameters<Parameters<typeof schoolAction>[1]>[0], upload: File) {
  if (upload.size > 5 * 1024 * 1024) throw new DomainError("fileTooLarge", "file");
  const records = await readSpreadsheet(Buffer.from(await upload.arrayBuffer()), upload.name);
  if (records.length === 0) throw new DomainError("emptyFile", "file");
  return validateStaffImport(ctx, records);
}

export const checkStaffImportAction = schoolAction(
  { permission: "staff.write", schema: importSchema },
  async (ctx, input) => {
    const rows = await readRows(ctx, input.file);
    return rows.map(({ line, values, errors }) => ({ line, values, errors })) satisfies ImportPreview;
  },
);

export const runStaffImportAction = schoolAction(
  { permission: "staff.write", schema: importSchema },
  async (ctx, input) => importStaff(ctx, await readRows(ctx, input.file), { sendAccess: input.sendAccess }),
);
