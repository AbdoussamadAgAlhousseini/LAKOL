import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listDebtors } from "@/server/services/finance/reports";
import { classOptions } from "@/server/services/options";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Card } from "@/components/ui/card";
import { FinanceNav } from "../finance-nav";
import { remindAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance.tabs"))("unpaid") };
}

export default async function UnpaidPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ classId?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "finance.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [t, debtors, classes] = await Promise.all([
    getTranslations("finance"),
    listDebtors(ctx, { classId: sp.classId, page: Number(sp.page) || 1 }),
    classOptions(ctx),
  ]);
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short" });
  const base = `/${school}/finance/unpaid`;

  return (
    <>
      <PageHeader
        title={t("tabs.unpaid")}
        description={t("unpaidSummary", { count: debtors.total, amount: money(debtors.sum) })}
        actions={
          debtors.total > 0 && (
            <ActionButton
              action={remindAction}
              school={school}
              fields={{}}
              confirm={t("remindAllConfirm")}
              variant="default"
              size="default"
            >
              {t("remindAll")}
            </ActionButton>
          )
        }
      />
      <FinanceNav ctx={ctx} school={school} active="unpaid" />
      <p className="text-muted-foreground mb-3 text-sm">{t("remindHint")}</p>
      <nav className="mb-4 flex flex-wrap gap-2">
        <Link href={base} className={cn("rounded-full border px-3 py-1.5 text-sm", !sp.classId && "bg-secondary")}>
          {t("allClasses")}
        </Link>
        {classes.map((c) => (
          <Link
            key={c.id}
            href={`${base}?classId=${c.id}`}
            className={cn("rounded-full border px-3 py-1.5 text-sm", sp.classId === c.id && "bg-secondary")}
          >
            {c.name}
          </Link>
        ))}
      </nav>
      {debtors.items.length === 0 ? (
        <p className="text-success py-10 text-center">{t("noUnpaid")}</p>
      ) : (
        <Card className="divide-y p-0">
          {debtors.items.map((d) => {
            const g = d.student.guardians[0]?.guardian;
            return (
              <div key={d.studentId} className="flex flex-wrap items-center gap-3 p-4" data-testid="debtor-row">
                <Link href={`/${school}/finance/students/${d.studentId}`} className="min-w-0 flex-1">
                  <span className="block font-medium underline-offset-4 hover:underline">
                    {d.student.lastName} {d.student.firstName}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {d.student.enrollments[0]?.class.name}
                    {g && ` · ${g.firstName} ${g.lastName} ${g.phone}`}
                    {d.lastReminderAt && ` · ${t("lastReminder", { date: fmt.format(d.lastReminderAt) })}`}
                  </span>
                </Link>
                <span className="text-destructive font-semibold tabular-nums">{money(d.amount)}</span>
                <ActionButton action={remindAction} school={school} fields={{ studentId: d.studentId, force: "on" }}>
                  {t("remind")}
                </ActionButton>
              </div>
            );
          })}
        </Card>
      )}
      <Pagination basePath={base} page={debtors.page} total={debtors.total} params={{ classId: sp.classId }} />
    </>
  );
}
