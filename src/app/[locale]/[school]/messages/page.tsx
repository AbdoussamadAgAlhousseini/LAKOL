import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Mic, PenSquare, ShieldAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listConversations } from "@/server/services/messaging";
import { cn } from "@/lib/utils";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("messages"))("title") };
}

export default async function MessagesPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => c.scope.permissions.has("message.send"));
  if (!ctx) return <Forbidden />;
  const [t, conversations] = await Promise.all([getTranslations("messages"), listConversations(ctx)]);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ctx.school.timezone,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={t("hint")}
        actions={
          <>
            {canAll(ctx.scope, "message.moderate") && (
              <Button variant="outline" asChild>
                <Link href={`/${school}/messages/moderation`}>
                  <ShieldAlert aria-hidden /> {t("moderation")}
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href={`/${school}/messages/new`}>
                <PenSquare aria-hidden /> {t("new")}
              </Link>
            </Button>
          </>
        }
      />
      <Card className="divide-y p-0" data-testid="conversations">
        {conversations.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("empty")}</p>}
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/${school}/messages/${c.id}`}
            className="hover:bg-accent flex items-start gap-3 p-4"
            data-testid="conversation"
          >
            <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full font-semibold">
              {c.with.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={cn("truncate", c.unread > 0 && "font-bold")}>{c.with}</p>
                {c.last && (
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">{fmt.format(c.last.createdAt)}</span>
                )}
              </div>
              {(c.subject || c.student) && (
                <p className="text-muted-foreground truncate text-xs">
                  {[c.subject, c.student && t("about", { name: c.student })].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className={cn("text-muted-foreground truncate text-sm", c.unread > 0 && "text-foreground")}>
                {c.last?.hiddenAt ? (
                  <em>{t("hidden")}</em>
                ) : c.last?.body ? (
                  c.last.body
                ) : c.last?.audioUrl ? (
                  <span className="inline-flex items-center gap-1">
                    <Mic className="size-3" aria-hidden /> {t("voice")}
                  </span>
                ) : null}
              </p>
            </div>
            {c.unread > 0 && <Badge aria-label={t("unread", { count: c.unread })}>{c.unread}</Badge>}
          </Link>
        ))}
      </Card>
    </div>
  );
}
