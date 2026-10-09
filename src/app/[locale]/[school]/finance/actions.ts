"use server";

import { z } from "zod";
import { schoolAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import {
  addDiscount,
  addOptionalFee,
  cancelInvoice,
  deleteFeeSchedule,
  generateInvoices,
  removeDiscount,
  saveFeeSchedule,
  saveFeeType,
} from "@/server/services/finance/fees";
import { cancelPayment, recordPayment } from "@/server/services/finance/payments";
import { sendPaymentReminders } from "@/server/services/finance/reminders";
import { closeCash, createExpense, deleteExpense } from "@/server/services/finance/reports";
import { payPayroll, preparePayroll, updatePayroll } from "@/server/services/finance/payroll";
import { checkbox, date, id, optionalId, optionalText, text } from "@/lib/zod";

/** Montant saisi en FCFA (« 25 000 », « 25000 ») -> entier. */
const amount = z
  .string()
  .transform((v) => v.replace(/[\s  .]/g, ""))
  .pipe(z.string().regex(/^\d{1,10}$/))
  .transform(Number);
const method = z.enum(["CASH", "CHEQUE", "TRANSFER"]);

export const recordPaymentAction = schoolAction(
  {
    permission: "payment.write",
    schema: z.object({
      studentId: id,
      amount,
      method,
      reference: optionalText(80),
      invoiceId: optionalId,
      guardianId: optionalId,
      paidAt: date.optional(),
    }),
  },
  async (ctx, input) => {
    const { payment } = await recordPayment(ctx, input);
    return { id: payment.id };
  },
);

export const cancelPaymentAction = schoolAction(
  { permission: "payment.cancel", schema: z.object({ paymentId: id, reason: text(300) }) },
  async (ctx, input) => cancelPayment(ctx, input),
);

export const cancelInvoiceAction = schoolAction(
  { permission: "payment.cancel", schema: z.object({ invoiceId: id, reason: text(300) }) },
  async (ctx, input) => cancelInvoice(ctx, input),
);

export const addDiscountAction = schoolAction(
  {
    permission: "fee.manage",
    schema: z.object({
      studentId: id,
      kind: z.enum(["SIBLING", "SCHOLARSHIP", "STAFF_CHILD", "EXCEPTIONAL"]),
      label: text(120),
      percent: z.coerce.number().min(0.5).max(100).optional(),
      amount: amount.optional(),
      feeTypeId: optionalId,
    }),
  },
  async (ctx, { percent, ...input }) => {
    if (!percent === !input.amount) throw new DomainError("discountValue", "percent");
    await addDiscount(ctx, { ...input, percentBp: percent ? Math.round(percent * 100) : null });
    // Les réductions s'appliquent aux prochaines échéances générées.
    await generateInvoices(ctx, { studentId: input.studentId });
  },
);

export const removeDiscountAction = schoolAction(
  { permission: "fee.manage", schema: z.object({ id }) },
  async (ctx, i) => removeDiscount(ctx, i.id),
);

export const addOptionalFeeAction = schoolAction(
  {
    permission: "fee.manage",
    schema: z.object({ studentId: id, feeTypeId: id, amount, label: optionalText(120), dueDate: date }),
  },
  async (ctx, input) => {
    await addOptionalFee(ctx, { ...input, label: input.label ?? "" });
  },
);

export const remindAction = schoolAction(
  { permission: "finance.read", schema: z.object({ studentId: optionalId, force: checkbox }) },
  async (ctx, input) => {
    // « finance.read » accepte aussi la variante « :own » : les relances sont réservées à la comptabilité.
    if (!canAll(ctx.scope, "finance.read")) throw new ForbiddenError();
    return sendPaymentReminders(ctx, {
      studentIds: input.studentId ? [input.studentId] : undefined,
      force: input.force,
    });
  },
);

export const createExpenseAction = schoolAction(
  {
    permission: "expense.write",
    schema: z.object({
      category: text(60),
      label: text(160),
      amount,
      method,
      reference: optionalText(80),
      spentAt: date,
    }),
  },
  async (ctx, input) => {
    await createExpense(ctx, input);
  },
);

export const deleteExpenseAction = schoolAction(
  { permission: "expense.write", schema: z.object({ id }) },
  async (ctx, i) => deleteExpense(ctx, i.id),
);

export const closeCashAction = schoolAction(
  { permission: "payment.write", schema: z.object({ date, countedCash: amount, note: optionalText(300) }) },
  async (ctx, input) => {
    await closeCash(ctx, input);
  },
);

export const saveFeeTypeAction = schoolAction(
  {
    permission: "fee.manage",
    schema: z.object({
      id: optionalId,
      name: text(80),
      category: z.enum(["REGISTRATION", "TUITION", "CANTEEN", "TRANSPORT", "UNIFORM", "SUPPLIES", "ACTIVITY", "OTHER"]),
      isOptional: checkbox,
    }),
  },
  async (ctx, input) => {
    await saveFeeType(ctx, input);
  },
);

export const saveFeeScheduleAction = schoolAction(
  {
    permission: "fee.manage",
    schema: z.object({
      id: optionalId,
      feeTypeId: id,
      levelId: optionalId,
      amount,
      frequency: z.enum(["ONCE", "MONTHLY", "TERMLY", "YEARLY"]),
    }),
  },
  async (ctx, input) => {
    await saveFeeSchedule(ctx, input);
  },
);

export const deleteFeeScheduleAction = schoolAction(
  { permission: "fee.manage", schema: z.object({ id }) },
  async (ctx, i) => deleteFeeSchedule(ctx, i.id),
);

export const generateInvoicesAction = schoolAction(
  { permission: "fee.manage", schema: z.object({ classId: optionalId }) },
  async (ctx, input) => generateInvoices(ctx, input),
);

export const preparePayrollAction = schoolAction(
  { permission: "payroll.manage", schema: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }) },
  async (ctx, input) => preparePayroll(ctx, input.period),
);

export const updatePayrollAction = schoolAction(
  {
    permission: "payroll.manage",
    schema: z.object({
      id,
      hours: z.coerce.number().min(0).max(400),
      bonuses: amount.optional(),
      deductions: amount.optional(),
    }),
  },
  async (ctx, input) =>
    updatePayroll(ctx, {
      id: input.id,
      hoursMinutes: Math.round(input.hours * 60),
      bonuses: input.bonuses ?? 0,
      deductions: input.deductions ?? 0,
    }),
);

export const payPayrollAction = schoolAction(
  { permission: "payroll.manage", schema: z.object({ id, method }) },
  async (ctx, input) => payPayroll(ctx, input),
);
