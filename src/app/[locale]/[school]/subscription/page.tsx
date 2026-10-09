import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { schoolSubscription } from "@/server/services/subscription";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { INVOICE_VARIANT, STATUS_VARIANT } from "@/components/admin/status";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toggleModuleAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("subscription"))("title") };
}

function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">
          {used} / {max ?? "∞"}
        </span>
      </div>
      {max !== null && (
        <div className="bg-muted h-2 overflow-hidden rounded-full" role="presentation">
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 90 ? "bg-destructive" : pct >= 75 ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default async function SubscriptionPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "school.settings.manage"));
  if (!ctx) return <Forbidden />;
  const [t, ta, tm, data] = await Promise.all([
    getTranslations("subscription"),
    getTranslations("admin"),
    getTranslations("modules"),
    schoolSubscription(ctx),
  ]);
  const { subscription: sub, limits } = data;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const money = (v: number) => formatMoney(v, sub?.plan.currency ?? "XOF", locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("hint")} />
      {sub && (
        <Card data-testid="school-subscription">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t("plan", { name: sub.plan.name })}
              <Badge variant={STATUS_VARIANT[sub.status]}>{ta(`statuses.${sub.status}`)}</Badge>
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {sub.status === "TRIAL" && sub.trialEndsAt
                ? t("trialUntil", { date: date.format(sub.trialEndsAt) })
                : sub.status === "PAST_DUE" && sub.graceEndsAt
                  ? t("pastDueUntil", { date: date.format(sub.graceEndsAt) })
                  : sub.status === "SUSPENDED"
                    ? t("suspended")
                    : sub.currentPeriodEnd
                      ? t("activeUntil", { date: date.format(sub.currentPeriodEnd) })
                      : t("freePlan")}
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Usage label={t("students")} used={data.students} max={limits?.maxStudents ?? null} />
            <Usage label={t("whatsapp")} used={data.whatsapp.used} max={data.whatsapp.quota} />
            {(limits?.pricePerStudent ?? 0) > 0 && (
              <p className="text-muted-foreground text-sm sm:col-span-2">
                {t("price", { price: money(limits!.pricePerStudent) })}
              </p>
            )}
            <p className="text-muted-foreground text-sm sm:col-span-2">{t("contact")}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("modules")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("modulesHint")}</p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="school-modules">
          {data.modules.map((m) => (
            <div
              key={m.key}
              className={cn("flex items-center gap-3 rounded-md border p-3 text-sm", !m.inPlan && "opacity-60")}
            >
              <span
                className={cn("size-2.5 rounded-full", m.active ? "bg-success" : "bg-muted-foreground/30")}
                aria-hidden
              />
              <span className="min-w-0 flex-1 font-medium">{tm(m.key)}</span>
              {m.inPlan ? (
                <ActionButton
                  action={toggleModuleAction}
                  school={school}
                  fields={{ module: m.key, ...(m.active ? {} : { enabled: "on" }) }}
                  confirm={m.active ? t("confirmDisable") : undefined}
                >
                  {m.active ? t("disable") : t("enable")}
                </ActionButton>
              ) : (
                <span className="text-muted-foreground text-xs">{m.active ? t("offered") : t("notIncluded")}</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invoices")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0" data-testid="school-invoices">
          {data.invoices.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noInvoice")}</p>}
          {data.invoices.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
              <a
                href={`/api/platform-invoices/${inv.id}`}
                target="_blank"
                className="text-primary inline-flex items-center gap-1 font-medium underline"
              >
                <FileText className="size-4" aria-hidden /> {inv.number}
              </a>
              <Badge variant={INVOICE_VARIANT[inv.status]}>{ta(`invoiceStatuses.${inv.status}`)}</Badge>
              <span className="font-semibold tabular-nums">{money(inv.amount)}</span>
              <span className="text-muted-foreground text-xs">
                {inv.status === "PAID" && inv.paidAt
                  ? ta("paidOn", { date: date.format(inv.paidAt) })
                  : ta("dueOn", { date: date.format(inv.dueDate) })}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
