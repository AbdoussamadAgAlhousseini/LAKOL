import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadSchoolPage } from "@/server/page-context";
import { listNotifications } from "@/server/services/notifications";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Card } from "@/components/ui/card";
import { markAllReadAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("notifications"))("title") };
}

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [t, { items, total, page, unread }] = await Promise.all([
    getTranslations("notifications"),
    listNotifications(ctx, { page: Number(sp.page) || 1 }),
  ]);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ctx.school.timezone,
  });
  // Liens internes uniquement (les liens des notifications sont relatifs à l'application).
  const href = (link: string | null) => (link && link.startsWith(`/${school}/`) ? link : null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={unread > 0 ? t("unread", { count: unread }) : t("allRead")}
        actions={
          unread > 0 && (
            <ActionButton action={markAllReadAction} school={school} fields={{}}>
              <CheckCheck aria-hidden /> {t("markAllRead")}
            </ActionButton>
          )
        }
      />
      <Card className="divide-y p-0" data-testid="notifications">
        {items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("empty")}</p>}
        {items.map((n) => {
          const content = (
            <>
              <span
                className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn(!n.readAt && "font-semibold")}>{n.title}</p>
                <p className="text-muted-foreground line-clamp-2 text-sm">{n.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">{fmt.format(n.createdAt)}</p>
              </div>
            </>
          );
          const link = href(n.link);
          return link ? (
            <Link key={n.id} href={link} className="hover:bg-accent flex gap-3 p-4">
              {content}
            </Link>
          ) : (
            <div key={n.id} className="flex gap-3 p-4">
              {content}
            </div>
          );
        })}
      </Card>
      <Pagination basePath={`/${school}/notifications`} page={page} total={total} params={{}} />
    </div>
  );
}
