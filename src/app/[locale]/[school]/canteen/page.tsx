import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, UtensilsCrossed, X } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { familyCanteen, listCanteenSubscribers, weekMenus } from "@/server/services/modules/canteen";
import { addDays, isoDate, weekStart } from "@/lib/time";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { StudentSelect } from "@/components/forms/student-select";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveMenuAction, subscribeAction, unsubscribeAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("canteen"))("title") };
}

export default async function CanteenPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(
    school,
    locale,
    (c) => canAll(c.scope, "canteen.manage") || c.scope.permissions.has("canteen.read:own"),
  );
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const manager = canAll(ctx.scope, "canteen.manage");
  const monday =
    sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? weekStart(new Date(`${sp.week}T00:00:00Z`)) : weekStart();
  const [t, menus] = await Promise.all([getTranslations("canteen"), weekMenus(ctx, monday)]);
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  const menuCard = (
    <Card data-testid="menus">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("menus")}</CardTitle>
        <div className="flex gap-3 text-sm">
          <a href={`?week=${isoDate(addDays(monday, -7))}`} className="text-primary underline">
            {t("previousWeek")}
          </a>
          <a href={`?week=${isoDate(addDays(monday, 7))}`} className="text-primary underline">
            {t("nextWeek")}
          </a>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {menus.map(({ day: d, menu }) => (
          <div key={d.toISOString()} className="rounded-md border p-3">
            <p className="text-sm font-semibold first-letter:uppercase">{day.format(d)}</p>
            {manager ? (
              <ActionForm
                action={saveMenuAction}
                school={school}
                successMessage={t("saved")}
                className="mt-2 gap-2 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="date" value={isoDate(d)} />
                <Field name="meal" label={t("meal")} className="flex-1">
                  <Input id={`meal-${isoDate(d)}`} name="meal" defaultValue={menu?.meal ?? ""} maxLength={200} />
                </Field>
                <Field name="notes" label={t("notes")} className="flex-1">
                  <Input id={`notes-${isoDate(d)}`} name="notes" defaultValue={menu?.notes ?? ""} maxLength={200} />
                </Field>
                <SubmitButton size="sm" variant="outline">
                  {t("save")}
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="mt-1 flex items-center gap-2 text-sm">
                <UtensilsCrossed className="text-primary size-4 shrink-0" aria-hidden />
                {menu ? (
                  <span>
                    {menu.meal}
                    {menu.notes && <span className="text-muted-foreground"> · {menu.notes}</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("noMenu")}</span>
                )}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );

  if (!manager) {
    const children = await familyCanteen(ctx);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("familyHint")} />
        <div className="grid gap-2 sm:grid-cols-2" data-testid="family-canteen">
          {children.map((c) => (
            <Card key={c.id} className="flex items-center gap-3 p-4">
              {c.subscribed ? (
                <CheckCircle2 className="text-success size-6 shrink-0" aria-hidden />
              ) : (
                <X className="text-muted-foreground size-6 shrink-0" aria-hidden />
              )}
              <span>
                <span className="block font-medium">{c.name}</span>
                <span className="text-muted-foreground text-sm">
                  {c.subscribed ? t("subscribed") : t("notSubscribed")}
                  {c.diet && ` · ${c.diet}`}
                </span>
              </span>
            </Card>
          ))}
        </div>
        {menuCard}
      </div>
    );
  }

  const subscribers = await listCanteenSubscribers(ctx);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("managerHint")} />
      {menuCard}
      <Card>
        <CardHeader>
          <CardTitle>{t("subscribers", { count: subscribers.length })}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ActionForm
            action={subscribeAction}
            school={school}
            resetOnSuccess
            successMessage={t("saved")}
            className="grid gap-3 sm:grid-cols-3"
          >
            <Field name="studentId" label={t("student")}>
              <StudentSelect ctx={ctx} />
            </Field>
            <Field name="dietNotes" label={t("diet")}>
              <Input id="dietNotes" name="dietNotes" maxLength={200} placeholder={t("dietPlaceholder")} />
            </Field>
            <SubmitButton className="self-end">{t("subscribe")}</SubmitButton>
          </ActionForm>
          <div className="divide-y rounded-md border" data-testid="subscribers">
            {subscribers.length === 0 && <p className="text-muted-foreground p-4 text-sm">{t("noSubscriber")}</p>}
            {subscribers.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-14 shrink-0 text-xs font-medium">{s.className}</span>
                <span className="min-w-0 flex-1">
                  {s.student.lastName} {s.student.firstName}
                  {s.dietNotes && <span className="text-muted-foreground block text-xs">{s.dietNotes}</span>}
                </span>
                <ActionButton
                  action={unsubscribeAction}
                  school={school}
                  fields={{ id: s.id }}
                  variant="ghost"
                  confirm={t("confirmUnsubscribe")}
                >
                  <X aria-hidden />
                  <span className="sr-only">{t("unsubscribe")}</span>
                </ActionButton>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{t("paymentsHint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
