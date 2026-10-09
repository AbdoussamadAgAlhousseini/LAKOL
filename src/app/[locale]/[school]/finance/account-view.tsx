import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import type { studentAccount } from "@/server/services/finance/payments";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Account = Awaited<ReturnType<typeof studentAccount>>;

const STATUS_VARIANT = { UNPAID: "destructive", PARTIAL: "warning", PAID: "success", CANCELLED: "secondary" } as const;

/** Synthèse, échéancier et paiements d'un élève (comptabilité et familles). */
export async function AccountView({
  account,
  school,
  locale,
  currency,
  actions,
}: {
  account: Account;
  school: string;
  locale: string;
  currency: string;
  /** Actions comptables par facture / paiement (absentes côté famille). */
  actions?: { invoice?: (id: string) => React.ReactNode; payment?: (id: string) => React.ReactNode };
}) {
  const t = await getTranslations("finance");
  const money = (v: number) => formatMoney(v, currency, locale);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["total", account.total, ""],
            ["paid", account.paid, "text-success"],
            ["balance", account.balance, account.balance > 0 ? "text-warning-foreground" : "text-success"],
            ["overdue", account.overdue, account.overdue > 0 ? "text-destructive" : "text-success"],
          ] as const
        ).map(([k, v, cls]) => (
          <Card key={k}>
            <CardContent className="pt-5">
              <p className={cn("text-xl font-bold tabular-nums", cls)} data-testid={`account-${k}`}>
                {money(v)}
              </p>
              <p className="text-muted-foreground text-sm">{t(`account.${k}`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("account.schedule")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {account.invoices.length === 0 && (
            <p className="text-muted-foreground px-5 pb-5 text-sm">{t("account.noInvoice")}</p>
          )}
          <ul className="divide-y">
            {account.invoices.map((inv) => {
              const late = inv.status !== "PAID" && inv.status !== "CANCELLED" && inv.dueDate <= now;
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                  data-testid="invoice-row"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{inv.label}</p>
                    <p className="text-muted-foreground">
                      {inv.number} · {t("account.due", { date: fmt.format(inv.dueDate) })}
                      {inv.lines.some((l) => l.amount < 0) &&
                        ` · ${inv.lines
                          .filter((l) => l.amount < 0)
                          .map((l) => l.label)
                          .join(", ")}`}
                    </p>
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                    <span className="text-right tabular-nums">
                      <span className="block font-semibold">{money(inv.total)}</span>
                      {inv.amountPaid > 0 && inv.status !== "PAID" && (
                        <span className="text-muted-foreground text-xs">
                          {t("account.alreadyPaid", { amount: money(inv.amountPaid) })}
                        </span>
                      )}
                    </span>
                    <Badge variant={late ? "destructive" : STATUS_VARIANT[inv.status]}>
                      {late ? t("account.late") : t(`invoiceStatus.${inv.status}`)}
                    </Badge>
                  </div>
                  {actions?.invoice?.(inv.id)}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("account.payments")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {account.payments.length === 0 && (
            <p className="text-muted-foreground px-5 pb-5 text-sm">{t("account.noPayment")}</p>
          )}
          <ul className="divide-y">
            {account.payments.map((p) => (
              <li
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-5 py-3 text-sm",
                  p.status === "CANCELLED" && "opacity-60",
                )}
                data-testid="payment-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {money(p.amount)} · {t(`methods.${p.method}`)}
                    {p.reference && ` (${p.reference})`}
                  </p>
                  <p className="text-muted-foreground">
                    {fmt.format(p.paidAt)} · {p.allocations.map((a) => a.invoice.label).join(", ")}
                  </p>
                  {p.status === "CANCELLED" && (
                    <p className="text-destructive">{t("account.cancelled", { reason: p.cancelledReason ?? "" })}</p>
                  )}
                </div>
                {p.receipt && (
                  <a
                    href={`/api/schools/${school}/receipts/${p.id}`}
                    target="_blank"
                    className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    <FileText className="size-4" /> {t("account.receipt", { number: p.receipt.number })}
                  </a>
                )}
                {p.status === "COMPLETED" && actions?.payment?.(p.id)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
