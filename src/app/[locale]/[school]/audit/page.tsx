import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { listAuditLogs } from "@/server/services/settings";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("audit"))("title") };
}

const ENTITIES = ["Student", "Staff", "User", "StudentGuardian", "AcademicYear", "School", "Document", "Term"] as const;

function summarize(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ")
    .slice(0, 160);
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ entity?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "audit.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const entity = ENTITIES.find((e) => e === sp.entity);
  const [t, { items, total, page }] = await Promise.all([
    getTranslations("audit"),
    listAuditLogs(ctx, { entityType: entity, page: Number(sp.page) || 1 }),
  ]);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const base = `/${school}/audit`;

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {[undefined, ...ENTITIES].map((e) => (
          <Link
            key={e ?? "all"}
            href={e ? `${base}?entity=${e}` : base}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm",
              e === entity && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {e ? t(`entities.${e}`) : t("all")}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>
      ) : (
        <Card className="divide-y p-0">
          {items.map((log) => (
            <div key={log.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:gap-4">
              <span className="text-muted-foreground shrink-0 tabular-nums sm:w-36">{fmt.format(log.createdAt)}</span>
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">
                    {log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : t("system")}
                  </span>{" "}
                  — {t.has(`actions.${log.action}`) ? t(`actions.${log.action}`) : log.action}
                </p>
                {(log.before || log.after) && (
                  <p className="text-muted-foreground truncate text-xs">
                    {log.before ? `${summarize(log.before)} → ` : ""}
                    {summarize(log.after)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <Pagination basePath={base} page={page} total={total} params={{ entity }} />
    </>
  );
}
