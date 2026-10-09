import { getTranslations } from "next-intl/server";
import { ExternalLink, FileText } from "lucide-react";
import { loadSchoolPage, loadOrDeny } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { getHomework } from "@/server/services/homework";
import { formatScore } from "@/lib/grades";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HomeworkStatus } from "../status";
import { deleteHomeworkAction, gradeSubmissionAction, submitHomeworkAction } from "../actions";

function Files({ files }: { files: { id: string; name: string }[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {files.map((f) => (
        <li key={f.id}>
          <a
            href={`/api/files/${f.id}`}
            target="_blank"
            className="text-primary inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline"
          >
            <FileText className="size-4" aria-hidden /> {f.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function HomeworkDetailPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx || !can(ctx.scope, "homework.read")) return <Forbidden />;
  const hw = await loadOrDeny(getHomework(ctx, id));
  if (!hw) return <Forbidden />;
  const t = await getTranslations("homework");
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
  const scale = ctx.school.gradingScale;
  const canSubmit = can(ctx.scope, "homework.submit");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={hw.title}
        description={`${hw.class.name} · ${hw.subject.name} · ${hw.staff.firstName} ${hw.staff.lastName}`}
        actions={
          hw.canGrade && (
            <ActionButton
              action={deleteHomeworkAction}
              school={school}
              fields={{ id: hw.id }}
              confirm={t("deleteConfirm")}
              redirectTo={`/${school}/homework`}
              variant="ghost"
            >
              {t("delete")}
            </ActionButton>
          )
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <p className="font-medium">{t("due", { date: fmt.format(hw.dueAt) })}</p>
          <p className="whitespace-pre-line">{hw.instructions}</p>
          {hw.link && (
            <a
              href={hw.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-2 underline"
            >
              <ExternalLink className="size-4" aria-hidden /> {hw.link}
            </a>
          )}
          <Files files={hw.attachments} />
        </CardContent>
      </Card>

      {hw.staffView ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("submissions")}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t("doneCount", {
                done: hw.rows.filter((r) => r.submission && r.submission.status !== "TODO").length,
                total: hw.rows.length,
              })}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {hw.rows.map(({ student, submission, files }) => (
                <li key={student.id} className="flex flex-col gap-2 px-5 py-3" data-testid="submission-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 font-medium">
                      {student.lastName} {student.firstName}
                    </span>
                    {submission?.submittedAt && submission.submittedAt > hw.dueAt && (
                      <span className="text-destructive text-xs">{t("late")}</span>
                    )}
                    <HomeworkStatus status={submission?.status ?? "TODO"} />
                    {submission?.score !== null && submission?.score !== undefined && (
                      <span className="text-sm font-semibold tabular-nums">
                        {formatScore(submission.score, locale)}/{scale}
                      </span>
                    )}
                  </div>
                  {submission?.content && (
                    <p className="text-muted-foreground text-sm whitespace-pre-line">{submission.content}</p>
                  )}
                  <Files files={files} />
                  {hw.canGrade &&
                    submission &&
                    (submission.status === "SUBMITTED" || submission.status === "GRADED") && (
                      <details>
                        <summary className="text-primary cursor-pointer text-sm">{t("grade")}</summary>
                        <ActionForm
                          action={gradeSubmissionAction}
                          school={school}
                          className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto]"
                        >
                          <input type="hidden" name="submissionId" value={submission.id} />
                          <Field name="score" label={t("scoreOn", { scale })}>
                            <Input
                              id={`score-${submission.id}`}
                              name="score"
                              inputMode="decimal"
                              defaultValue={submission.score !== null ? formatScore(submission.score, locale) : ""}
                            />
                          </Field>
                          <Field name="feedback" label={t("feedback")}>
                            <Input
                              id={`fb-${submission.id}`}
                              name="feedback"
                              defaultValue={submission.feedback ?? ""}
                            />
                          </Field>
                          <SubmitButton size="sm" className="self-end">
                            {t("saveGrade")}
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        hw.rows.map(({ student, submission, files }) => (
          <Card key={student.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                {student.firstName} {student.lastName}
                <HomeworkStatus status={submission?.status ?? "TODO"} />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {submission?.submittedAt && (
                <p className="text-muted-foreground text-sm">
                  {t("submittedAt", { date: short.format(submission.submittedAt) })}
                </p>
              )}
              {submission?.content && <p className="text-sm whitespace-pre-line">{submission.content}</p>}
              <Files files={files} />
              {submission?.status === "GRADED" && (
                <div className="bg-success/10 rounded-lg p-3 text-sm">
                  {submission.score !== null && (
                    <p className="text-lg font-bold">
                      {formatScore(submission.score, locale)}/{scale}
                    </p>
                  )}
                  {submission.feedback && <p>{submission.feedback}</p>}
                </div>
              )}
              {canSubmit && hw.allowSubmission && submission?.status !== "GRADED" && (
                <ActionForm
                  action={submitHomeworkAction}
                  school={school}
                  resetOnSuccess
                  successMessage={t("submitted")}
                >
                  <input type="hidden" name="homeworkId" value={hw.id} />
                  <input type="hidden" name="studentId" value={student.id} />
                  <Field name="content" label={t("yourWork")}>
                    <Textarea id="content" name="content" />
                  </Field>
                  <Field name="files" label={t("attachments")} hint={t("attachmentsHint")}>
                    <Input
                      id="submission-files"
                      name="files[]"
                      type="file"
                      multiple
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      capture="environment"
                      className="pt-3"
                    />
                  </Field>
                  <SubmitButton size="lg" className="self-start">
                    {t("submit")}
                  </SubmitButton>
                </ActionForm>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
