import { formatMoney } from "@/lib/money";
import { notifyGuardians, type NotifyContext } from "../notify";

// Sans « server-only » : utilisé aussi par le worker (tâche planifiée).

// ── Relances ───────────────────────────────────────────────────────────────

const REMINDER_INTERVAL_DAYS = 7;

/**
 * Relance par WhatsApp les familles ayant un impayé échu, au plus une fois
 * par semaine et par élève. Seuls les tuteurs autorisés à voir les frais
 * sont prévenus.
 */
export async function sendPaymentReminders(
  ctx: NotifyContext,
  options: { studentIds?: string[]; force?: boolean } = {},
) {
  const now = new Date();
  const since = new Date(now.getTime() - REMINDER_INTERVAL_DAYS * 86_400_000);
  const overdue = await ctx.db.invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIAL"] },
      deletedAt: null,
      dueDate: { lte: now },
      ...(options.studentIds ? { studentId: { in: options.studentIds } } : {}),
    },
    include: { student: true },
  });
  const byStudent = new Map<string, typeof overdue>();
  for (const inv of overdue) byStudent.set(inv.studentId, [...(byStudent.get(inv.studentId) ?? []), inv]);

  let reminded = 0;
  for (const [studentId, invoices] of byStudent) {
    const last = Math.max(0, ...invoices.map((i) => i.lastReminderAt?.getTime() ?? 0));
    if (!options.force && last > since.getTime()) continue;
    const amount = invoices.reduce((t, i) => t + i.total - i.amountPaid, 0);
    const student = invoices[0].student;
    const notified = await notifyGuardians(
      ctx,
      studentId,
      {
        type: "finance.reminder",
        title: `Frais scolaires — ${student.firstName}`,
        body: `Bonjour, il reste ${formatMoney(amount, ctx.school.currency)} à régler pour ${student.firstName} ${student.lastName} (${invoices.map((i) => i.label).join(", ")}). Le paiement se fait à l'école (espèces, chèque ou virement). Merci.`,
        link: `/${ctx.school.slug}/finance`,
      },
      ["WHATSAPP", "EMAIL"],
      { canViewFinance: true },
    );
    if (notified === 0) continue;
    await ctx.db.invoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) } },
      data: { lastReminderAt: now },
    });
    reminded += 1;
  }
  return { reminded };
}
