import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listPayroll } from "@/server/services/finance/payroll";
import { formatMoney } from "@/lib/money";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FinanceNav } from "../finance-nav";
import { payPayrollAction, preparePayrollAction, updatePayrollAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance.tabs"))("payroll") };
}

export default async function PayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "payroll.manage"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : new Date().toISOString().slice(0, 7);
  const [t, rows] = await Promise.all([getTranslations("finance"), listPayroll(ctx, period)]);
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const total = rows.reduce((s, r) => s + r.netAmount, 0);

  return (
    <>
      <PageHeader
        title={t("tabs.payroll")}
        description={t("payroll.total", { amount: money(total), count: rows.length })}
        actions={
          <ActionButton
            action={preparePayrollAction}
            school={school}
            fields={{ period }}
            variant="default"
            size="default"
          >
            {t("payroll.prepare")}
          </ActionButton>
        }
      />
      <FinanceNav ctx={ctx} school={school} active="payroll" />
      <form className="mb-4 flex gap-2">
        <Input name="period" type="month" defaultValue={period} aria-label={t("month")} className="w-48" />
        <Button type="submit" variant="secondary" className="h-12">
          {t("show")}
        </Button>
      </form>
      {rows.length === 0 && <p className="text-muted-foreground py-6">{t("payroll.empty")}</p>}
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <Card key={r.id} data-testid="payroll-row">
            <CardContent className="flex flex-col gap-3 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 font-semibold">
                  {r.staff.lastName} {r.staff.firstName}{" "}
                  <span className="text-muted-foreground font-normal">· {r.staff.position}</span>
                </span>
                <span className="text-lg font-bold tabular-nums">{money(r.netAmount)}</span>
                <Badge variant={r.status === "PAID" ? "success" : "warning"}>{t(`payroll.status.${r.status}`)}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("payroll.detail", {
                  base: money(r.baseAmount),
                  hours: r.hoursMinutes / 60,
                  hourly: money(r.hourlyAmount),
                  bonuses: money(r.bonuses),
                  deductions: money(r.deductions),
                })}
              </p>
              {r.status !== "PAID" && (
                <div className="flex flex-wrap items-end gap-3">
                  <ActionForm
                    action={updatePayrollAction}
                    school={school}
                    className="flex-row flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={r.id} />
                    {r.staff.contractType === "HOURLY" && (
                      <label className="flex flex-col gap-1 text-xs">
                        {t("payroll.hours")}
                        <Input
                          name="hours"
                          inputMode="decimal"
                          defaultValue={r.hoursMinutes / 60}
                          className="h-10 w-24"
                        />
                      </label>
                    )}
                    {r.staff.contractType !== "HOURLY" && (
                      <input type="hidden" name="hours" value={r.hoursMinutes / 60} />
                    )}
                    <label className="flex flex-col gap-1 text-xs">
                      {t("payroll.bonuses")}
                      <Input name="bonuses" inputMode="numeric" defaultValue={r.bonuses || ""} className="h-10 w-28" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      {t("payroll.deductions")}
                      <Input
                        name="deductions"
                        inputMode="numeric"
                        defaultValue={r.deductions || ""}
                        className="h-10 w-28"
                      />
                    </label>
                    <SubmitButton size="sm" variant="outline">
                      {t("payroll.update")}
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm
                    action={payPayrollAction}
                    school={school}
                    confirm={t("payroll.payConfirm")}
                    className="flex-row items-end gap-2"
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <Select name="method" defaultValue="CASH" aria-label={t("pay.method")} className="h-10 w-36">
                      {(["CASH", "CHEQUE", "TRANSFER"] as const).map((m) => (
                        <option key={m} value={m}>
                          {t(`methods.${m}`)}
                        </option>
                      ))}
                    </Select>
                    <SubmitButton size="sm">{t("payroll.pay")}</SubmitButton>
                  </ActionForm>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
