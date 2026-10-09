import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can, canAll } from "@/server/rbac/policies";
import type { SchoolContext } from "@/server/context";
import { financeOverview } from "@/server/services/finance/reports";
import { studentAccount } from "@/server/services/finance/payments";
import { formatMoney, formatPercent } from "@/lib/money";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountView } from "./account-view";
import { FinanceNav } from "./finance-nav";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance"))("title") };
}

export default async function FinancePage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "finance.read"));
  if (!ctx) return <Forbidden />;
  return canAll(ctx.scope, "finance.read") ? (
    <Dashboard ctx={ctx} school={school} locale={locale} />
  ) : (
    <FamilyFinance ctx={ctx} school={school} locale={locale} />
  );
}

async function Dashboard({ ctx, school, locale }: { ctx: SchoolContext; school: string; locale: string }) {
  const t = await getTranslations("finance");
  const o = await financeOverview(ctx);
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const maxMonth = Math.max(1, ...o.byMonth.map((m) => m.amount));
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" });

  return (
    <>
      <PageHeader title={t("title")} description={t("yearLabel", { year: o.year.name })} />
      <FinanceNav ctx={ctx} school={school} active="dashboard" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["expected", money(o.expected)],
            ["collected", money(o.collected)],
            ["rate", formatPercent(o.rate, locale)],
            ["overdue", money(o.overdue)],
          ] as const
        ).map(([k, v]) => (
          <Card key={k}>
            <CardContent className="pt-5">
              <p className="text-xl font-bold tabular-nums sm:text-2xl" data-testid={`kpi-${k}`}>
                {v}
              </p>
              <p className="text-muted-foreground text-sm">{t(`kpi.${k}`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-sm">
        {t("debtors", { count: o.debtorCount })} ·{" "}
        <Link href={`/${school}/finance/unpaid`} className="text-primary underline">
          {t("seeUnpaid")}
        </Link>{" "}
        · {t("expensesTotal", { amount: money(o.expenses) })}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("byClass")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {o.byClass.map((c) => {
              const pct = c.expected ? Math.round((c.collected / c.expected) * 100) : 0;
              return (
                <div key={c.classId} data-testid="class-finance">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {money(c.collected)} / {money(c.expected)} · {pct} %
                    </span>
                  </div>
                  <div
                    className="bg-muted mt-1 h-2 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={c.name}
                  >
                    <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  {c.overdue > 0 && (
                    <p className="text-destructive mt-1 text-xs">
                      {t("classOverdue", { amount: money(c.overdue), count: c.debtors })}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("byMonth")}</CardTitle>
          </CardHeader>
          <CardContent>
            {o.byMonth.length === 0 && <p className="text-muted-foreground text-sm">{t("noPayment")}</p>}
            <ol className="flex flex-col gap-2">
              {o.byMonth.map((m) => (
                <li key={m.month} className="grid grid-cols-[4rem_1fr_7rem] items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{monthFmt.format(new Date(`${m.month}-01T00:00:00Z`))}</span>
                  <span
                    className="bg-primary/80 h-3 rounded"
                    style={{ width: `${Math.max(2, (m.amount / maxMonth) * 100)}%` }}
                  />
                  <span className="text-right tabular-nums">{money(m.amount)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Parent / élève : frais de chaque enfant (si le parent y a accès). */
async function FamilyFinance({ ctx, school, locale }: { ctx: SchoolContext; school: string; locale: string }) {
  const t = await getTranslations("finance");
  const students = await ctx.db.student.findMany({
    where: { id: { in: [...ctx.scope.studentIds] } },
    orderBy: { firstName: "asc" },
  });
  return (
    <>
      <PageHeader title={t("familyTitle")} description={t("familyIntro")} />
      <div className="flex flex-col gap-10">
        {await Promise.all(
          students.map(async (s) => {
            let account;
            try {
              account = await studentAccount(ctx, s.id);
            } catch {
              return (
                <Alert key={s.id}>
                  {s.firstName} : {t("hidden")}
                </Alert>
              );
            }
            return (
              <section key={s.id} className="flex flex-col gap-3" data-testid="family-account">
                <h2 className="text-lg font-semibold">
                  {s.firstName} {s.lastName}
                </h2>
                <AccountView account={account} school={school} locale={locale} currency={ctx.school.currency} />
              </section>
            );
          }),
        )}
      </div>
    </>
  );
}
