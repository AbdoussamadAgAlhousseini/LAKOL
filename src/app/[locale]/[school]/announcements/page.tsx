import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Send } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadSchoolPage } from "@/server/page-context";
import { listAnnouncements } from "@/server/services/announcements";
import { getActiveYear } from "@/server/services/structure";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { AudiencePicker } from "@/components/messaging/audience-picker";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAnnouncementAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("announcements"))("title") };
}

export default async function AnnouncementsPage({
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
  const [t, { items, total, page, publisher }] = await Promise.all([
    getTranslations("announcements"),
    listAnnouncements(ctx, { page: Number(sp.page) || 1 }),
  ]);
  const year = publisher ? await getActiveYear(ctx) : null;
  const [levels, classes] = publisher
    ? await Promise.all([
        ctx.db.level.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
        ctx.db.class.findMany({
          where: { academicYearId: year?.id ?? "" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : [[], []];
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: ctx.school.timezone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        actions={
          publisher && (
            <Button variant="outline" asChild>
              <Link href={`/${school}/announcements/deliveries`}>
                <Send aria-hidden /> {t("deliveries")}
              </Link>
            </Button>
          )
        }
      />
      {publisher && (
        <Card>
          <CardHeader>
            <CardTitle>{t("new")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("newHint")}</p>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createAnnouncementAction}
              school={school}
              redirectTo={`/${school}/announcements/{id}`}
              confirm={t("confirmPublish")}
              className="grid gap-4 sm:grid-cols-2"
            >
              <Field name="title" label={t("titleField")} className="sm:col-span-2">
                <Input id="title" name="title" maxLength={160} required />
              </Field>
              <Field name="body" label={t("body")} className="sm:col-span-2">
                <Textarea id="body" name="body" maxLength={5000} required className="min-h-32" />
              </Field>
              <AudiencePicker
                labels={{
                  audience: t("audience"),
                  SCHOOL: t("audiences.SCHOOL"),
                  PARENTS: t("audiences.PARENTS"),
                  STAFF: t("audiences.STAFF"),
                  LEVEL: t("audiences.LEVEL"),
                  CLASS: t("audiences.CLASS"),
                  levels: t("levels"),
                  classes: t("classes"),
                }}
                levels={levels}
                classes={classes}
              />
              <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
                <legend className="mb-2 font-medium">{t("channels")}</legend>
                <p className="text-muted-foreground text-xs">{t("channelsHint")}</p>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    name="channels[]"
                    value="WHATSAPP"
                    defaultChecked
                    className="accent-primary size-5"
                  />
                  WhatsApp
                </label>
                <label className="flex items-center gap-3">
                  <input type="checkbox" name="channels[]" value="EMAIL" className="accent-primary size-5" />
                  Email
                </label>
                <label className="mt-2 flex items-center gap-3">
                  <input type="checkbox" name="requiresAck" className="accent-primary size-5" />
                  {t("requiresAck")}
                </label>
              </fieldset>
              <SubmitButton className="self-start">{t("publish")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card className="divide-y p-0" data-testid="announcements">
        {items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("empty")}</p>}
        {items.map((a) => {
          const acked = a.acks.length > 0;
          return (
            <Link
              key={a.id}
              href={`/${school}/announcements/${a.id}`}
              className="hover:bg-accent flex items-start gap-3 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.title}</p>
                <p className="text-muted-foreground line-clamp-2 text-sm">{a.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {a.publishedAt && fmt.format(a.publishedAt)}
                  {publisher && ` · ${t(`audiences.${a.audience}`)} · ${t("recipients", { count: a.recipientCount })}`}
                  {publisher && a.requiresAck && ` · ${t("ackCount", { count: a._count.acks })}`}
                </p>
              </div>
              {a.requiresAck &&
                !publisher &&
                (acked ? (
                  <CheckCircle2 className="text-success size-5 shrink-0" aria-label={t("acked")} />
                ) : (
                  <Badge variant="warning">{t("toAck")}</Badge>
                ))}
            </Link>
          );
        })}
      </Card>
      <Pagination basePath={`/${school}/announcements`} page={page} total={total} params={{}} />
    </div>
  );
}
