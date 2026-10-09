import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "@/server/services/context";
import { addDiscount, generateInvoices, saveFeeSchedule, saveFeeType } from "@/server/services/finance/fees";
import { cancelPayment, receiptPdf, recordPayment, studentAccount } from "@/server/services/finance/payments";
import { sendPaymentReminders } from "@/server/services/finance/reminders";
import { closeCash, createExpense, dailyCash, financeOverview, listDebtors } from "@/server/services/finance/reports";
import { listPayroll, payPayroll, preparePayroll, updatePayroll } from "@/server/services/finance/payroll";
import { dayStart } from "@/lib/time";
import { contextFor } from "./helpers";

let accountant: ServiceContext;
let director: ServiceContext;
let teacher: ServiceContext;
let parent: ServiceContext;
let moussa: string;
let aminata: string;

beforeAll(async () => {
  accountant = await contextFor("les-etoiles", { email: "comptable@les-etoiles.lakol.test" }, "ACCOUNTANT");
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
  teacher = await contextFor("les-etoiles", { email: "prof.maths@les-etoiles.lakol.test" }, "HEAD_TEACHER");
  parent = await contextFor("les-etoiles", { phone: "+22370000001" }, "PARENT");
  moussa = (await accountant.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0030" } })).id;
  aminata = (await accountant.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0029" } })).id;
});

afterAll(() => prisma.$disconnect());

describe("échéanciers", () => {
  it("ne recrée pas les échéances déjà facturées ; une nouvelle grille est facturée une seule fois", async () => {
    expect((await generateInvoices(accountant, {})).created).toBe(0);

    const level9 = await accountant.db.level.findFirstOrThrow({ where: { name: "9e année" } });
    const feeType = await saveFeeType(accountant, { name: "Frais d'examen DEF", category: "OTHER", isOptional: false });
    await saveFeeSchedule(accountant, { feeTypeId: feeType.id, levelId: level9.id, amount: 15000, frequency: "ONCE" });
    const students9 = await accountant.db.enrollment.count({
      where: { class: { levelId: level9.id }, status: "ACTIVE" },
    });

    // Bourse de 50 % pour Moussa (9e A) sur ces frais
    await addDiscount(accountant, {
      studentId: moussa,
      kind: "SCHOLARSHIP",
      label: "Bourse 50 %",
      percentBp: 5000,
      feeTypeId: feeType.id,
    });

    expect((await generateInvoices(accountant, {})).created).toBe(students9);
    expect((await generateInvoices(accountant, {})).created).toBe(0);
    const invoice = await accountant.db.invoice.findFirstOrThrow({
      where: { studentId: moussa, label: { startsWith: "Frais d'examen" } },
      include: { lines: true },
    });
    expect(invoice.total).toBe(7500);
    expect(invoice.lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([-7500, 15000]);
  });

  it("un professeur ne gère pas les frais", async () => {
    await expect(generateInvoices(teacher, {})).rejects.toThrow(ForbiddenError);
    await expect(recordPayment(teacher, { studentId: aminata, amount: 1000, method: "CASH" })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("paiements (parcours 5)", () => {
  it("le caissier enregistre un paiement en espèces : réparti sur les plus anciennes échéances, reçu numéroté", async () => {
    const before = await studentAccount(accountant, aminata);
    const open = before.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
    const first = open[0];
    const amount = first.total - first.amountPaid + 5000;

    const { payment, receipt } = await recordPayment(accountant, { studentId: aminata, amount, method: "CASH" });
    expect(receipt.number).toMatch(/^REC-\d{4}-\d{5}$/);
    const allocations = await accountant.db.paymentAllocation.findMany({
      where: { paymentId: payment.id },
      include: { invoice: true },
    });
    expect(allocations[0].invoiceId).toBe(first.id);
    expect(allocations[0].invoice.status).toBe("PAID");
    expect(allocations[1].amount).toBe(5000);

    const after = await studentAccount(accountant, aminata);
    expect(after.balance).toBe(before.balance - amount);

    // Le parent voit le paiement, et son reçu PDF.
    const familyView = await studentAccount(parent, aminata);
    expect(familyView.payments.some((p) => p.id === payment.id)).toBe(true);
    const { pdf } = await receiptPdf(parent, payment.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Numérotation sans trou
    const next = await recordPayment(accountant, {
      studentId: aminata,
      amount: 1000,
      method: "CHEQUE",
      reference: "CHQ-001",
    });
    expect(Number(next.receipt.number.slice(-5))).toBe(Number(receipt.number.slice(-5)) + 1);
  });

  it("refuse un trop-perçu et un chèque sans référence", async () => {
    const account = await studentAccount(accountant, aminata);
    await expect(
      recordPayment(accountant, { studentId: aminata, amount: account.balance + 1, method: "CASH" }),
    ).rejects.toThrow("overpayment");
    await expect(recordPayment(accountant, { studentId: aminata, amount: 1000, method: "CHEQUE" })).rejects.toThrow(
      "referenceRequired",
    );
  });

  it("l'annulation rouvre les factures et est tracée ; seul un profil autorisé peut annuler", async () => {
    const before = await studentAccount(accountant, aminata);
    const { payment } = await recordPayment(accountant, { studentId: aminata, amount: 2000, method: "CASH" });
    await expect(cancelPayment(accountant, { paymentId: payment.id, reason: "x" })).rejects.toThrow(ForbiddenError);
    await cancelPayment(director, { paymentId: payment.id, reason: "Erreur de saisie" });
    const after = await studentAccount(accountant, aminata);
    expect(after.balance).toBe(before.balance);
    expect(await prisma.auditLog.count({ where: { action: "payment.cancel", entityId: payment.id } })).toBe(1);
    const { pdf } = await receiptPdf(accountant, payment.id);
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("un parent ne voit que ses enfants, et seulement s'il a accès aux frais", async () => {
    const other = await accountant.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0001" } });
    await expect(studentAccount(parent, other.id)).rejects.toThrow(ForbiddenError);
    const link = await prisma.studentGuardian.findFirstOrThrow({
      where: { studentId: aminata, guardian: { phone: "+22370000001" } },
    });
    await prisma.studentGuardian.update({ where: { id: link.id }, data: { canViewFinance: false } });
    await expect(studentAccount(parent, aminata)).rejects.toThrow(ForbiddenError);
    await prisma.studentGuardian.update({ where: { id: link.id }, data: { canViewFinance: true } });
  });
});

describe("relances, caisse, tableaux de bord", () => {
  it("relance les impayés au plus une fois par semaine", async () => {
    const first = await sendPaymentReminders(accountant);
    expect(first.reminded).toBeGreaterThan(0);
    expect((await sendPaymentReminders(accountant)).reminded).toBe(0);
    expect((await sendPaymentReminders(accountant, { studentIds: [moussa], force: true })).reminded).toBe(1);
    const sent = await prisma.notificationDelivery.count({
      where: { notification: { type: "finance.reminder" }, recipient: "+22370000001" },
    });
    expect(sent).toBeGreaterThan(0);
  });

  it("caisse du jour : espèces attendues, clôture avec écart justifié", async () => {
    const today = dayStart();
    await createExpense(accountant, {
      category: "Fournitures",
      label: "Craies",
      amount: 3000,
      method: "CASH",
      spentAt: new Date(),
    });
    const day = await dailyCash(accountant, today);
    const cashIn = day.byMethod.find((m) => m.method === "CASH")!.in;
    expect(day.expectedCash).toBe(cashIn - day.byMethod.find((m) => m.method === "CASH")!.out);
    await expect(closeCash(accountant, { date: today, countedCash: day.expectedCash - 500 })).rejects.toThrow(
      "differenceNeedsNote",
    );
    const closing = await closeCash(accountant, {
      date: today,
      countedCash: day.expectedCash - 500,
      note: "Monnaie rendue en trop",
    });
    expect(closing.difference).toBe(-500);
    await expect(closeCash(accountant, { date: today, countedCash: 0 })).rejects.toThrow("alreadyClosed");
  });

  it("tableau de bord : attendu, encaissé, impayés par classe", async () => {
    const o = await financeOverview(director);
    expect(o.expected).toBeGreaterThan(0);
    expect(o.collected).toBeLessThanOrEqual(o.expected);
    expect(o.byClass.reduce((t, c) => t + c.expected, 0)).toBe(o.expected);
    const debtors = await listDebtors(director, {});
    expect(debtors.total).toBe(o.debtorCount);
    await expect(financeOverview(teacher)).rejects.toThrow(ForbiddenError);
  });

  it("paie : salaire de base, vacations, paiement enregistré en dépense", async () => {
    await preparePayroll(accountant, "2026-10");
    const list = await listPayroll(accountant, "2026-10");
    const hourly = list.find((p) => p.staff.contractType === "HOURLY")!;
    await updatePayroll(accountant, { id: hourly.id, hoursMinutes: 600, bonuses: 0, deductions: 0 });
    const updated = await prisma.payroll.findUniqueOrThrow({ where: { id: hourly.id } });
    expect(updated.netAmount).toBe(10 * hourly.staff.hourlyRate!);
    await payPayroll(accountant, { id: hourly.id, method: "CASH" });
    expect(
      await prisma.expense.count({ where: { category: "Salaires", label: { contains: hourly.staff.lastName } } }),
    ).toBe(1);
    await expect(payPayroll(accountant, { id: hourly.id, method: "CASH" })).rejects.toThrow("payrollPaid");
  });
});
