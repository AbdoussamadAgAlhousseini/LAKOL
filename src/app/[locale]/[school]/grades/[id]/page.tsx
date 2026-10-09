import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { loadSchoolPage, loadOrDeny } from "@/server/page-context";
import { getGradeSheet } from "@/server/services/assessments";
import { formatScore } from "@/lib/grades";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteAssessmentAction, importGradesAction } from "../actions";
import { GradeGrid } from "./grade-grid";

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  const sheet = await loadOrDeny(getGradeSheet(ctx, id));
  if (!sheet) return <Forbidden />;
  const t = await getTranslations("grades");
  const a = sheet.assessment;
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const value = (g: (typeof sheet.rows)[number]["grade"]) =>
    !g ? "" : g.isAbsent ? "abs" : g.score === null ? "" : formatScore(g.score, locale);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title={a.title}
        description={`${a.class.name} · ${a.subject.name} · ${t(`types.${a.type}`)} · ${fmt.format(a.date)} · ${a.term.name} · ×${a.weight}`}
        actions={
          sheet.canEdit &&
          !a.isLocked && (
            <ActionButton
              action={deleteAssessmentAction}
              school={school}
              fields={{ id: a.id }}
              confirm={t("deleteConfirm")}
              redirectTo={`/${school}/grades?term=${a.termId}`}
              variant="ghost"
            >
              {t("delete")}
            </ActionButton>
          )
        }
      />
      {a.isLocked && (
        <Alert>
          <Lock /> {sheet.canEdit ? t("lockedEditable") : t("lockedInfo")}
        </Alert>
      )}
      <GradeGrid
        school={school}
        assessmentId={a.id}
        outOf={a.outOf}
        disabled={!sheet.canEdit}
        rows={sheet.rows.map((r) => ({
          id: r.student.id,
          name: `${r.student.lastName} ${r.student.firstName}`,
          value: value(r.grade),
        }))}
      />
      {sheet.canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t("importTitle")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("importHint")}</p>
          </CardHeader>
          <CardContent>
            <ActionForm action={importGradesAction} school={school} successMessage={t("saved")}>
              <input type="hidden" name="assessmentId" value={a.id} />
              <Field name="file" label={t("importFile")}>
                <Input id="grades-file" name="file" type="file" accept=".xlsx,.csv" required className="pt-3" />
              </Field>
              <SubmitButton size="sm" variant="outline" className="self-start">
                {t("import")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
