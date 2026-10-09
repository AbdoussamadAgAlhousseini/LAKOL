import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import type { PlatformInvoiceStatus } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { listPlatformInvoices } from "@/server/platform/admin";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { INVOICE_VARIANT } from "@/components/admin/status";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const STATUSES = ["ISSUED", "PAID", "VOID"] as const;

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) as PlatformInvoiceStatus | undefined;
  const [t, invoices] = await Promise.all([getTranslations("admin"), listPlatformInvoices({ status })]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("nav.invoices")} />
      <nav className="flex flex-wrap gap-2">
        {[undefined, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={`/admin/invoices${s ? `?status=${s}` : ""}`}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm",
              s === status && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {s ? t(`invoiceStatuses.${s}`) : t("all")}
          </Link>
        ))}
      </nav>
      <Card className="divide-y p-0" data-testid="invoices">
        {invoices.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noInvoice")}</p>}
        {invoices.map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm">
            <a
              href={`/api/platform-invoices/${inv.id}`}
              target="_blank"
              className="text-primary inline-flex items-center gap-1 font-medium underline"
            >
              <FileText className="size-4" aria-hidden /> {inv.number}
            </a>
            <Link href={`/admin/schools/${inv.school.id}`} className="min-w-0 flex-1 truncate hover:underline">
              {inv.school.name}
            </Link>
            <Badge variant={INVOICE_VARIANT[inv.status]}>{t(`invoiceStatuses.${inv.status}`)}</Badge>
            <span className="font-semibold tabular-nums">{formatMoney(inv.amount, inv.currency, locale)}</span>
            <span
              className={cn(
                "text-muted-foreground w-full text-xs sm:w-auto",
                inv.status === "ISSUED" && inv.dueDate < now && "text-destructive font-medium",
              )}
            >
              {inv.status === "PAID" && inv.paidAt
                ? t("paidOn", { date: date.format(inv.paidAt) })
                : t("dueOn", { date: date.format(inv.dueDate) })}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
