import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { platformOverview } from "@/server/platform/admin";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin"))("title") };
}

export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [t, o] = await Promise.all([getTranslations("admin"), platformOverview()]);
  const money = (v: number) => formatMoney(v, "XOF", locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const stats = [
    { label: t("stats.schools"), value: String(o.schools) },
    { label: t("stats.students"), value: o.students.toLocaleString(locale) },
    { label: t("stats.annualRevenue"), value: money(o.annualRevenue) },
    { label: t("stats.collected"), value: money(o.collectedThisYear) },
    { label: t("stats.outstanding"), value: money(o.outstanding) },
    { label: t("stats.whatsapp"), value: o.whatsappThisMonth.toLocaleString(locale) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("dashboardTitle")} />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="platform-stats">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <dt className="text-muted-foreground text-xs">{s.label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{s.value}</dd>
          </Card>
        ))}
      </dl>
      {o.overdue > 0 && (
        <Link
          href="/admin/invoices?status=ISSUED"
          className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border p-3 text-sm font-medium"
        >
          <AlertTriangle className="size-4" aria-hidden /> {t("overdue", { amount: money(o.overdue) })}
        </Link>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("byStatus")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const).map((s) => (
              <Link
                key={s}
                href={`/admin/schools?status=${s}`}
                className="hover:bg-accent flex justify-between rounded-md px-2 py-1.5"
              >
                <span>{t(`statuses.${s}`)}</span>
                <span className="font-semibold tabular-nums">{o.byStatus[s] ?? 0}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("trialsEnding")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {o.trialsEndingSoon.length === 0 && <p className="text-muted-foreground">{t("noTrialEnding")}</p>}
            {o.trialsEndingSoon.map((s) => (
              <Link
                key={s.id}
                href={`/admin/schools/${s.id}`}
                className="hover:bg-accent flex justify-between rounded-md px-2 py-1.5"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">{date.format(s.trialEndsAt)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
