import { getTranslations } from "next-intl/server";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadSchoolPage, loadOrDeny } from "@/server/page-context";
import { announcementStats, getAnnouncement } from "@/server/services/announcements";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acknowledgeAction, remindAction } from "../actions";

export default async function AnnouncementPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  const a = await loadOrDeny(getAnnouncement(ctx, id));
  if (!a) return <Forbidden />;
  const stats = a.publisher ? await announcementStats(ctx, id) : null;
  const t = await getTranslations("announcements");
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: ctx.school.timezone });
  const isRecipient = !a.publisher || a.authorId !== ctx.user.id;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${school}/announcements`} className="text-primary inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" aria-hidden /> {t("title")}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{a.title}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {a.author && `${a.author.firstName} ${a.author.lastName} · `}
            {a.publishedAt && fmt.format(a.publishedAt)}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="whitespace-pre-wrap" data-testid="announcement-body">
            {a.body}
          </p>
          {a.requiresAck &&
            isRecipient &&
            (a.acked ? (
              <p className="text-success inline-flex items-center gap-2 font-medium" data-testid="acked">
                <CheckCircle2 aria-hidden /> {t("acked")}
              </p>
            ) : (
              !stats && (
                <ActionButton action={acknowledgeAction} school={school} fields={{ id }} variant="default" size="lg">
                  <CheckCircle2 aria-hidden /> {t("acknowledge")}
                </ActionButton>
              )
            ))}
        </CardContent>
      </Card>

      {stats && (
        <Card data-testid="announcement-stats">
          <CardHeader>
            <CardTitle>{t("tracking")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t("recipientsLabel")} value={stats.recipients} />
              <Stat label={t("readInApp")} value={stats.readInApp} />
              <Stat label={t("whatsappRead")} value={stats.deliveries.read} />
              {a.requiresAck && <Stat label={t("acks")} value={stats.acks} />}
            </dl>
            <p className="text-muted-foreground text-sm">
              {t("deliverySummary", {
                total: stats.deliveries.total,
                queued: stats.deliveries.queued,
                sent: stats.deliveries.sent,
                delivered: stats.deliveries.delivered,
                failed: stats.deliveries.failed,
              })}
            </p>
            {a.requiresAck && stats.notAcknowledged.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {t("notAcked", { count: stats.notAcknowledged.length })}
                </summary>
                <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  {stats.notAcknowledged.map((u) => (
                    <li key={u.id}>
                      {u.name} {u.phone && <span className="text-muted-foreground">· {u.phone}</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <ActionButton action={remindAction} school={school} fields={{ id }} confirm={t("confirmRemind")}>
                    {t("remind")}
                  </ActionButton>
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
