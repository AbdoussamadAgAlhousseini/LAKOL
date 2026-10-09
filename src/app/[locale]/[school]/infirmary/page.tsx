import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BellRing } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listVisits } from "@/server/services/modules/infirmary";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { StudentSelect } from "@/components/forms/student-select";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { recordVisitAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("infirmary"))("title") };
}

const OUTCOMES = ["RETURNED_TO_CLASS", "RESTED", "SENT_HOME", "REFERRED"] as const;
const VARIANT = {
  RETURNED_TO_CLASS: "success",
  RESTED: "secondary",
  SENT_HOME: "warning",
  REFERRED: "destructive",
} as const;

export default async function InfirmaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "infirmary.manage"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [t, visits] = await Promise.all([
    getTranslations("infirmary"),
    listVisits(ctx, { page: Number(sp.page) || 1 }),
  ]);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ctx.school.timezone,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("hint")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("newVisit")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={recordVisitAction}
            school={school}
            resetOnSuccess
            successMessage={t("saved")}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Field name="studentId" label={t("student")}>
              <StudentSelect ctx={ctx} />
            </Field>
            <Field name="reason" label={t("reason")}>
              <Input id="reason" name="reason" required maxLength={200} placeholder={t("reasonPlaceholder")} />
            </Field>
            <Field name="care" label={t("care")}>
              <Input id="care" name="care" maxLength={500} />
            </Field>
            <Field name="outcome" label={t("outcome")} hint={t("outcomeHint")}>
              <Select id="outcome" name="outcome" defaultValue="RETURNED_TO_CLASS">
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {t(`outcomes.${o}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton className="self-start">{t("record")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <Card className="divide-y p-0" data-testid="visits">
        {visits.items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("empty")}</p>}
        {visits.items.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm">
            <span className="text-muted-foreground w-28 shrink-0 text-xs">{when.format(v.at)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                {v.student.lastName} {v.student.firstName}
              </span>
              <span className="text-muted-foreground block">
                {v.reason}
                {v.care && ` · ${v.care}`}
              </span>
            </span>
            <Badge variant={VARIANT[v.outcome]}>{t(`outcomes.${v.outcome}`)}</Badge>
            {v.parentNotified && <BellRing className="text-muted-foreground size-4" aria-label={t("parentNotified")} />}
          </div>
        ))}
      </Card>
      <Pagination basePath={`/${school}/infirmary`} page={visits.page} total={visits.total} params={{}} />
    </div>
  );
}
