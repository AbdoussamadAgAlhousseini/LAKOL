import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Trash2 } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { getActiveYear } from "@/server/services/structure";
import { classOptions } from "@/server/services/options";
import type { Installment } from "@/server/services/finance/fees";
import { formatMoney } from "@/lib/money";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FinanceNav } from "../finance-nav";
import { deleteFeeScheduleAction, generateInvoicesAction, saveFeeScheduleAction, saveFeeTypeAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance.tabs"))("fees") };
}

const CATEGORIES = [
  "REGISTRATION",
  "TUITION",
  "CANTEEN",
  "TRANSPORT",
  "UNIFORM",
  "SUPPLIES",
  "ACTIVITY",
  "OTHER",
] as const;
const FREQUENCIES = ["ONCE", "MONTHLY", "TERMLY", "YEARLY"] as const;

export default async function FeesPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "fee.manage"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("finance");
  const year = await getActiveYear(ctx);
  if (!year) return <Alert>{t("noYear")}</Alert>;
  const [feeTypes, schedules, levels, classes] = await Promise.all([
    ctx.db.feeType.findMany({ orderBy: { name: "asc" } }),
    ctx.db.feeSchedule.findMany({
      where: { academicYearId: year.id },
      include: { feeType: true, level: true },
      orderBy: [{ level: { order: "asc" } }],
    }),
    ctx.db.level.findMany({ orderBy: { order: "asc" } }),
    classOptions(ctx),
  ]);
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <>
      <PageHeader title={t("tabs.fees")} description={t("feesIntro", { year: year.name })} />
      <FinanceNav ctx={ctx} school={school} active="fees" />
      <div className="flex flex-col gap-6">
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>{t("generate.title")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("generate.hint")}</p>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={generateInvoicesAction}
              school={school}
              successMessage={t("generate.done")}
              className="flex-row flex-wrap items-end gap-3"
            >
              <Field name="classId" label={t("class")}>
                <Select id="gen-class" name="classId" defaultValue="" className="w-56">
                  <option value="">{t("allClasses")}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton>{t("generate.submit")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("schedules.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {schedules.map((s) => (
              <div key={s.id} className="rounded-lg border p-3 text-sm" data-testid="fee-schedule">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.feeType.name}</span>
                  <Badge variant="outline">{s.level?.name ?? t("schedules.allLevels")}</Badge>
                  <span className="ml-auto font-semibold tabular-nums">
                    {money(s.amount)} · {t(`frequencies.${s.frequency}`)}
                  </span>
                  <ActionButton
                    action={deleteFeeScheduleAction}
                    school={school}
                    fields={{ id: s.id }}
                    confirm={t("deleteConfirm")}
                    variant="ghost"
                    size="icon"
                  >
                    <Trash2 aria-label={t("delete")} />
                  </ActionButton>
                </div>
                <p className="text-muted-foreground mt-1">
                  {((s.installments as unknown as Installment[] | null) ?? [])
                    .map((i) => `${i.label} (${fmt.format(new Date(`${i.dueDate}T00:00:00Z`))})`)
                    .join(" · ")}
                </p>
              </div>
            ))}
            <ActionForm
              action={saveFeeScheduleAction}
              school={school}
              resetOnSuccess
              className="grid gap-3 border-t pt-4 sm:grid-cols-5"
            >
              <Field name="feeTypeId" label={t("schedules.feeType")}>
                <Select id="sch-type" name="feeTypeId" defaultValue={feeTypes[0]?.id}>
                  {feeTypes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="levelId" label={t("schedules.level")}>
                <Select id="sch-level" name="levelId" defaultValue="">
                  <option value="">{t("schedules.allLevels")}</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="amount" label={t("schedules.amount")}>
                <Input id="sch-amount" name="amount" inputMode="numeric" required />
              </Field>
              <Field name="frequency" label={t("schedules.frequency")}>
                <Select id="sch-frequency" name="frequency" defaultValue="TERMLY">
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {t(`frequencies.${f}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton className="self-end">{t("schedules.add")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("feeTypes.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {feeTypes.map((f) => (
                <Badge key={f.id} variant="outline">
                  {f.name} · {t(`categories.${f.category}`)}
                  {f.isOptional && ` · ${t("feeTypes.optional")}`}
                </Badge>
              ))}
            </div>
            <ActionForm action={saveFeeTypeAction} school={school} resetOnSuccess className="grid gap-3 sm:grid-cols-4">
              <Field name="name" label={t("feeTypes.name")}>
                <Input id="ft-name" name="name" required />
              </Field>
              <Field name="category" label={t("feeTypes.category")}>
                <Select id="ft-category" name="category" defaultValue="OTHER">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-3 self-end pb-3 text-sm">
                <input type="checkbox" name="isOptional" className="accent-primary size-5" />
                {t("feeTypes.optionalHint")}
              </label>
              <SubmitButton className="self-end">{t("feeTypes.add")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
