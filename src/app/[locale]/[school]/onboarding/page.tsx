import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { onboardingState, type OnboardingStep } from "@/server/services/onboarding";
import { defaultSchoolYear } from "@/lib/school-templates";
import { isoDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { applyTemplateAction, finishOnboardingAction, schoolBasicsAction, startYearAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("onboarding"))("title") };
}

const CYCLES = ["MATERNELLE", "FONDAMENTAL_1", "FONDAMENTAL_2", "LYCEE"] as const;

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "school.settings.manage"));
  if (!ctx) return <Forbidden />;
  const [t, state] = await Promise.all([getTranslations("onboarding"), onboardingState(ctx)]);
  const current = state.steps.find((s) => !s.done)?.key;
  const year = defaultSchoolYear();
  const s = ctx.school;

  const content: Record<OnboardingStep, React.ReactNode> = {
    school: (
      <ActionForm action={schoolBasicsAction} school={school} className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label={t("schoolName")} className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={s.name} required />
        </Field>
        <Field name="city" label={t("city")}>
          <Input id="city" name="city" defaultValue={s.city ?? ""} required />
        </Field>
        <Field name="phone" label={t("phone")}>
          <Input id="phone" name="phone" type="tel" defaultValue={s.phone ?? ""} required />
        </Field>
        <Field name="address" label={t("address")}>
          <Input id="address" name="address" defaultValue={s.address ?? ""} />
        </Field>
        <Field name="email" label={t("email")}>
          <Input id="email" name="email" type="email" defaultValue={s.email ?? ""} />
        </Field>
        <SubmitButton className="self-start">{t("save")}</SubmitButton>
      </ActionForm>
    ),
    year: state.year ? (
      <p className="text-sm">{t("yearActive", { name: state.year.name })}</p>
    ) : (
      <ActionForm action={startYearAction} school={school} className="grid gap-4 sm:grid-cols-3">
        <Field name="name" label={t("yearName")}>
          <Input id="yearName" name="name" defaultValue={year.name} required />
        </Field>
        <Field name="startDate" label={t("startDate")}>
          <Input id="startDate" name="startDate" type="date" defaultValue={isoDate(year.startDate)} />
        </Field>
        <Field name="endDate" label={t("endDate")}>
          <Input id="endDate" name="endDate" type="date" defaultValue={isoDate(year.endDate)} />
        </Field>
        <p className="text-muted-foreground text-xs sm:col-span-3">{t("yearHint")}</p>
        <SubmitButton className="self-start">{t("createYear")}</SubmitButton>
      </ActionForm>
    ),
    classes: (
      <div className="flex flex-col gap-4">
        {state.year ? (
          <ActionForm action={applyTemplateAction} school={school} successMessage={t("templateApplied")}>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("chooseCycles")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {CYCLES.map((c) => (
                  <label key={c} className="flex min-h-12 items-center gap-3 rounded-md border px-3 text-sm">
                    <input
                      type="checkbox"
                      name="cycles[]"
                      value={c}
                      defaultChecked={c === "FONDAMENTAL_1" || c === "FONDAMENTAL_2"}
                      className="accent-primary size-5"
                    />
                    <span>
                      <span className="font-medium">{t(`cycles.${c}`)}</span>
                      <span className="text-muted-foreground block text-xs">{t(`cycleLevels.${c}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-muted-foreground text-xs">{t("templateHint")}</p>
            <SubmitButton className="self-start">{t("applyTemplate")}</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-muted-foreground text-sm">{t("needYear")}</p>
        )}
        <Link href={`/${school}/structure`} className="text-primary text-sm underline">
          {t("customize")}
        </Link>
      </div>
    ),
    students: (
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/${school}/students/import`}>{t("importStudents")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/${school}/students/new`}>{t("addStudent")}</Link>
        </Button>
        <p className="text-muted-foreground w-full text-xs">{t("studentsHint")}</p>
      </div>
    ),
    teachers: (
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/${school}/staff/new`}>{t("inviteTeacher")}</Link>
        </Button>
        <p className="text-muted-foreground w-full text-xs">{t("teachersHint")}</p>
      </div>
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={t("progress", { done: state.completed, total: state.total })}
        actions={
          <ActionButton
            action={finishOnboardingAction}
            school={school}
            fields={{}}
            redirectTo={`/${school}/dashboard`}
            variant={state.completed === state.total ? "default" : "ghost"}
          >
            {state.completed === state.total ? t("finish") : t("skip")}
          </ActionButton>
        }
      />
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={state.completed}
        aria-valuemin={0}
        aria-valuemax={state.total}
      >
        <div className="bg-primary h-full" style={{ width: `${(state.completed / state.total) * 100}%` }} />
      </div>
      <ol className="flex flex-col gap-3" data-testid="onboarding-steps">
        {state.steps.map((step, i) => (
          <li key={step.key}>
            <Card className={cn(step.key === current && "border-primary")} data-testid={`step-${step.key}`}>
              <details open={step.key === current}>
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  {step.done ? (
                    <CheckCircle2 className="text-success size-6 shrink-0" aria-label={t("done")} />
                  ) : (
                    <Circle className="text-muted-foreground size-6 shrink-0" aria-hidden />
                  )}
                  <span className="flex-1">
                    <span className="text-muted-foreground text-xs">{t("step", { n: i + 1 })}</span>
                    <span className="block font-semibold">{t(`steps.${step.key}`)}</span>
                  </span>
                </summary>
                <CardContent className="pt-0">
                  <p className="text-muted-foreground mb-4 text-sm">{t(`stepHints.${step.key}`)}</p>
                  {content[step.key]}
                </CardContent>
              </details>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
