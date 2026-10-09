import { getTranslations } from "next-intl/server";
import { ArrowLeft, Flag } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage, loadOrDeny } from "@/server/page-context";
import { getConversation } from "@/server/services/messaging";
import { cn } from "@/lib/utils";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Composer } from "@/components/messaging/composer";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { reportMessageAction, sendMessageAction } from "../actions";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => c.scope.permissions.has("message.send"));
  if (!ctx) return <Forbidden />;
  const conversation = await loadOrDeny(getConversation(ctx, id));
  if (!conversation) return <Forbidden />;
  const t = await getTranslations("messages");
  const others = conversation.participants
    .filter((p) => p.userId !== ctx.user.id)
    .map((p) => `${p.user.firstName} ${p.user.lastName}`)
    .join(", ");
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ctx.school.timezone,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link href={`/${school}/messages`} className="hover:bg-accent rounded-md p-2" aria-label={t("back")}>
          <ArrowLeft aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{others}</h1>
          {(conversation.subject || conversation.student) && (
            <p className="text-muted-foreground truncate text-sm">
              {[
                conversation.subject,
                conversation.student &&
                  t("about", { name: `${conversation.student.firstName} ${conversation.student.lastName}` }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      <ol className="flex flex-col gap-3" data-testid="thread">
        {conversation.messages.map((m) => {
          const mine = m.senderId === ctx.user.id;
          return (
            <li key={m.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap",
                  mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm",
                )}
                data-testid="message"
              >
                {m.hiddenAt ? (
                  <em className="opacity-80">{t("hidden")}</em>
                ) : (
                  <>
                    {m.body}
                    {m.audioUrl && (
                      <audio controls preload="none" src={m.audioUrl} className="mt-1 h-10 max-w-full">
                        {t("voice")}
                      </audio>
                    )}
                  </>
                )}
              </div>
              <span className="text-muted-foreground px-1 text-xs">
                {!mine && `${m.sender.firstName} · `}
                {fmt.format(m.createdAt)}
              </span>
              {!mine && !m.hiddenAt && !m.reportedAt && (
                <details className="text-xs">
                  <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 px-1">
                    <Flag className="size-3" aria-hidden /> {t("report")}
                  </summary>
                  <ActionForm
                    action={reportMessageAction}
                    school={school}
                    successMessage={t("reported")}
                    className="mt-2 w-72 max-w-full"
                  >
                    <input type="hidden" name="messageId" value={m.id} />
                    <Field name="reason" label={t("reportReason")}>
                      <Input id={`reason-${m.id}`} name="reason" maxLength={300} required />
                    </Field>
                    <SubmitButton size="sm" variant="destructive" className="self-start">
                      {t("report")}
                    </SubmitButton>
                  </ActionForm>
                </details>
              )}
              {!mine && m.reportedAt && !m.hiddenAt && (
                <span className="text-muted-foreground px-1 text-xs">{t("reportedBadge")}</span>
              )}
            </li>
          );
        })}
      </ol>

      <Card className="sticky bottom-0">
        <CardContent className="pt-4">
          <Composer action={sendMessageAction} school={school} fields={{ conversationId: conversation.id }} />
        </CardContent>
      </Card>
    </div>
  );
}
