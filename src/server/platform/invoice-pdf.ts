import "server-only";
import { prisma } from "@/server/db/client";
import { getCurrentSession } from "@/server/auth/session";
import { getSchoolContext } from "@/server/context";
import { canAll } from "@/server/rbac/policies";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

/** PDF d'une facture LAKOL : super admin, ou direction de l'école facturée. */
export async function platformInvoicePdf(id: string) {
  const current = await getCurrentSession();
  if (!current) return null;
  const invoice = await prisma.platformInvoice.findUnique({ where: { id }, include: { school: true } });
  if (!invoice) return null;
  if (!current.user.isPlatformAdmin) {
    const ctx = await getSchoolContext(invoice.school.slug);
    if (!ctx || !canAll(ctx.scope, "school.settings.manage")) return null;
  }
  const { renderPlatformInvoice } = await import("@/server/pdf/platform-invoice");
  const pdf = await renderPlatformInvoice({
    number: invoice.number,
    issuedAt: fmt(invoice.createdAt),
    dueDate: fmt(invoice.dueDate),
    status: invoice.status,
    paidAt: invoice.paidAt ? fmt(invoice.paidAt) : null,
    school: {
      name: invoice.school.name,
      city: invoice.school.city,
      address: invoice.school.address,
      phone: invoice.school.phone,
      email: invoice.school.email,
    },
    planName: invoice.planName,
    period: `du ${fmt(invoice.periodStart)} au ${fmt(invoice.periodEnd)}`,
    studentCount: invoice.studentCount,
    pricePerStudent: invoice.pricePerStudent,
    amount: invoice.amount,
    currency: invoice.currency,
    notes: invoice.status === "VOID" ? invoice.notes : null,
  });
  return { number: invoice.number, pdf };
}
