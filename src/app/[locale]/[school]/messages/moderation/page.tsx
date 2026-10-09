import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listReportedMessages } from "@/server/services/messaging";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { moderateMessageAction } from "../actions";

export default async function ModerationPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "message.moderate"));
  if (!ctx) return <Forbidden />;
  const [t, messages] = await Promise.all([getTranslations("messages"), listReportedMessages(ctx)]);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ctx.school.timezone,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("moderation")} description={t("moderationHint")} />
      <Card className="divide-y p-0" data-testid="reported">
        {messages.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noReport")}</p>}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {m.sender.firstName} {m.sender.lastName}
                <span className="text-muted-foreground ml-2 text-xs font-normal">{fmt.format(m.createdAt)}</span>
                {m.hiddenAt && (
                  <Badge variant="destructive" className="ml-2">
                    {t("hiddenBadge")}
                  </Badge>
                )}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.body ?? t("voice")}</p>
              {m.audioUrl && <audio controls preload="none" src={m.audioUrl} className="mt-1 h-10 max-w-full" />}
              <p className="text-muted-foreground mt-1 text-xs">
                {t("reportReason")} : {m.reportReason}
              </p>
            </div>
            <div className="flex gap-2">
              {m.hiddenAt ? (
                <ActionButton action={moderateMessageAction} school={school} fields={{ messageId: m.id }}>
                  {t("restore")}
                </ActionButton>
              ) : (
                <>
                  <ActionButton
                    action={moderateMessageAction}
                    school={school}
                    fields={{ messageId: m.id, hidden: "on" }}
                    variant="destructive"
                  >
                    {t("hide")}
                  </ActionButton>
                  <ActionButton action={moderateMessageAction} school={school} fields={{ messageId: m.id }}>
                    {t("dismiss")}
                  </ActionButton>
                </>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
