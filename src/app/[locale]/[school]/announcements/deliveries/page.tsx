import { getTranslations } from "next-intl/server";
import { RotateCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listDeliveries } from "@/server/services/notifications";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { retryDeliveriesAction } from "../actions";

const STATUSES = ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"] as const;
const VARIANT = {
  QUEUED: "secondary",
  SENT: "outline",
  DELIVERED: "success",
  READ: "success",
  FAILED: "destructive",
} as const;

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "announcement.publish"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const [t, { items, total, page, counts }] = await Promise.all([
    getTranslations("announcements"),
    listDeliveries(ctx, { status, page: Number(sp.page) || 1 }),
  ]);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ctx.school.timezone,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("deliveries")}
        description={t("deliveriesHint")}
        actions={
          (counts.FAILED ?? 0) > 0 && (
            <ActionButton action={retryDeliveriesAction} school={school} fields={{}}>
              <RotateCw aria-hidden /> {t("retry", { count: counts.FAILED })}
            </ActionButton>
          )
        }
      />
      <nav className="flex flex-wrap gap-2">
        {[undefined, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={`/${school}/announcements/deliveries${s ? `?status=${s}` : ""}`}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              s === status && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {s ? `${t(`statuses.${s}`)} (${counts[s] ?? 0})` : t("all")}
          </Link>
        ))}
      </nav>
      <Card className="divide-y p-0" data-testid="deliveries">
        {items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noDelivery")}</p>}
        {items.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
            <Badge variant={VARIANT[d.status]}>{t(`statuses.${d.status}`)}</Badge>
            <span className="font-medium">{d.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</span>
            <span className="text-muted-foreground">{d.recipient}</span>
            <span className="min-w-0 flex-1 truncate">{d.notification.title}</span>
            <span className="text-muted-foreground text-xs">
              {d.scheduledFor && d.status === "QUEUED"
                ? t("scheduledFor", { date: fmt.format(d.scheduledFor) })
                : fmt.format(d.createdAt)}
            </span>
            {d.error && <p className="text-destructive w-full text-xs">{d.error}</p>}
          </div>
        ))}
      </Card>
      <Pagination basePath={`/${school}/announcements/deliveries`} page={page} total={total} params={{ status }} />
    </div>
  );
}
