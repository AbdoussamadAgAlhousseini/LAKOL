import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { dailyCash } from "@/server/services/finance/reports";
import { listPayments } from "@/server/services/finance/payments";
import { formatMoney } from "@/lib/money";
import { addDays, dayStart, isoDate, parseIsoDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { FinanceNav } from "../finance-nav";
import { closeCashAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance.tabs"))("cash") };
}

/** Caisse du jour : encaissements, dépenses, espèces attendues et clôture. */
export default async function CashPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "finance.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const date = parseIsoDate(sp.date) ?? dayStart();
  const [t, day, payments] = await Promise.all([
    getTranslations("finance"),
    dailyCash(ctx, date),
    listPayments(ctx, { from: date, to: addDays(date, 1) }),
  ]);
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" });
  const base = `/${school}/finance/cash`;

  return (
    <>
      <PageHeader
        title={t("tabs.cash")}
        description={<span className="first-letter:uppercase">{fmt.format(date)}</span>}
      />
      <FinanceNav ctx={ctx} school={school} active="cash" />
      <form className="mb-4 flex gap-2">
        <Button variant="outline" asChild>
          <Link href={`${base}?date=${isoDate(addDays(date, -1))}`}>←</Link>
        </Button>
        <Input name="date" type="date" defaultValue={isoDate(date)} aria-label={t("date")} className="w-44" />
        <Button type="submit" variant="secondary" className="h-12">
          {t("show")}
        </Button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("cash.summary")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t("pay.method")}</Th>
                  <Th className="text-right">{t("cash.in")}</Th>
                  <Th className="text-right">{t("cash.out")}</Th>
                </tr>
              </thead>
              <tbody>
                {day.byMethod
                  .filter((m) => m.in || m.out || m.method !== "MOBILE_MONEY")
                  .map((m) => (
                    <tr key={m.method}>
                      <Td>{t(`methods.${m.method}`)}</Td>
                      <Td className="text-right tabular-nums">{money(m.in)}</Td>
                      <Td className="text-right tabular-nums">{money(m.out)}</Td>
                    </tr>
                  ))}
                <tr className="font-semibold">
                  <Td>{t("cash.total", { count: day.count })}</Td>
                  <Td className="text-right tabular-nums">{money(day.totalIn)}</Td>
                  <Td className="text-right tabular-nums">{money(day.totalOut)}</Td>
                </tr>
              </tbody>
            </Table>
          </CardContent>
        </Card>
        <Card className={cn(day.closing && "border-success")}>
          <CardHeader>
            <CardTitle>{t("cash.closing")}</CardTitle>
            <p className="text-sm">
              {t("cash.expected")} :{" "}
              <span className="font-bold tabular-nums" data-testid="expected-cash">
                {money(day.expectedCash)}
              </span>
            </p>
          </CardHeader>
          <CardContent>
            {day.closing ? (
              <Alert variant={day.closing.difference === 0 ? "success" : "destructive"}>
                {t("cash.closed", {
                  counted: money(day.closing.countedCash),
                  difference: money(day.closing.difference),
                })}
                {day.closing.note && <span className="block">« {day.closing.note} »</span>}
              </Alert>
            ) : canAll(ctx.scope, "payment.write") ? (
              <ActionForm action={closeCashAction} school={school}>
                <input type="hidden" name="date" value={isoDate(date)} />
                <Field name="countedCash" label={t("cash.counted")}>
                  <Input id="countedCash" name="countedCash" inputMode="numeric" required />
                </Field>
                <Field name="note" label={t("cash.note")} hint={t("cash.noteHint")}>
                  <Input id="note" name="note" />
                </Field>
                <SubmitButton className="self-start">{t("cash.close")}</SubmitButton>
              </ActionForm>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("cash.payments", { amount: money(payments.sum) })}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payments.items.length === 0 && <p className="text-muted-foreground px-5 pb-5 text-sm">{t("noPayment")}</p>}
          <ul className="divide-y">
            {payments.items.map((p) => (
              <li
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-5 py-3 text-sm",
                  p.status === "CANCELLED" && "line-through opacity-60",
                )}
              >
                <span className="text-muted-foreground w-12 tabular-nums">{time.format(p.paidAt)}</span>
                <Link
                  href={`/${school}/finance/students/${p.studentId}`}
                  className="flex-1 font-medium underline-offset-4 hover:underline"
                >
                  {p.student.lastName} {p.student.firstName}
                </Link>
                <span>{t(`methods.${p.method}`)}</span>
                <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                {p.receipt && (
                  <a
                    href={`/api/schools/${school}/receipts/${p.id}`}
                    target="_blank"
                    className="text-primary inline-flex items-center gap-1"
                  >
                    <FileText className="size-4" /> {p.receipt.number}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
