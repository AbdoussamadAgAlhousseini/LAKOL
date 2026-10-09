import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Trash2 } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { EXPENSE_CATEGORIES, listExpenses } from "@/server/services/finance/reports";
import { formatMoney } from "@/lib/money";
import { isoDate, parseIsoDate } from "@/lib/time";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FinanceNav } from "../finance-nav";
import { createExpenseAction, deleteExpenseAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance.tabs"))("expenses") };
}

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "finance.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const from = parseIsoDate(`${month}-01`)!;
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const [t, data] = await Promise.all([
    getTranslations("finance"),
    listExpenses(ctx, { from, to, page: Number(sp.page) || 1 }),
  ]);
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const canWrite = canAll(ctx.scope, "expense.write");

  return (
    <>
      <PageHeader title={t("tabs.expenses")} description={t("expensesMonth", { amount: money(data.sum) })} />
      <FinanceNav ctx={ctx} school={school} active="expenses" />
      <form className="mb-4 flex gap-2">
        <Input name="month" type="month" defaultValue={month} aria-label={t("month")} className="w-48" />
        <Button type="submit" variant="secondary" className="h-12">
          {t("show")}
        </Button>
      </form>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="divide-y p-0">
          {data.items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noExpense")}</p>}
          {data.items.map((e) => (
            <div key={e.id} className="flex items-center gap-3 p-4 text-sm" data-testid="expense-row">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{e.label}</p>
                <p className="text-muted-foreground">
                  {fmt.format(e.spentAt)} · {e.category} · {t(`methods.${e.method}`)}
                  {e.reference && ` · ${e.reference}`}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{money(e.amount)}</span>
              {canWrite && (
                <ActionButton
                  action={deleteExpenseAction}
                  school={school}
                  fields={{ id: e.id }}
                  confirm={t("deleteConfirm")}
                  variant="ghost"
                  size="icon"
                >
                  <Trash2 aria-label={t("delete")} />
                </ActionButton>
              )}
            </div>
          ))}
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("byCategory")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {data.byCategory.map((c) => (
                <p key={c.category} className="flex justify-between">
                  <span>{c.category}</span>
                  <span className="tabular-nums">{money(c.amount)}</span>
                </p>
              ))}
            </CardContent>
          </Card>
          {canWrite && (
            <Card>
              <CardHeader>
                <CardTitle>{t("newExpense")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={createExpenseAction} school={school} resetOnSuccess successMessage={t("saved")}>
                  <Field name="category" label={t("category")}>
                    <Select id="category" name="category" defaultValue="Fournitures">
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field name="label" label={t("label")}>
                    <Input id="label" name="label" required />
                  </Field>
                  <Field name="amount" label={t("pay.amount")}>
                    <Input id="expense-amount" name="amount" inputMode="numeric" required />
                  </Field>
                  <Field name="method" label={t("pay.method")}>
                    <Select id="expense-method" name="method" defaultValue="CASH">
                      {(["CASH", "CHEQUE", "TRANSFER"] as const).map((m) => (
                        <option key={m} value={m}>
                          {t(`methods.${m}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field name="reference" label={t("pay.reference")}>
                    <Input id="expense-ref" name="reference" />
                  </Field>
                  <Field name="spentAt" label={t("date")}>
                    <Input id="spentAt" name="spentAt" type="date" defaultValue={isoDate(new Date())} />
                  </Field>
                  <SubmitButton className="self-start">{t("save")}</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Pagination basePath={`/${school}/finance/expenses`} page={data.page} total={data.total} params={{ month }} />
    </>
  );
}
