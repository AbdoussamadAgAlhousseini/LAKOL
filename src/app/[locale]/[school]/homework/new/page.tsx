import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { myAssignments } from "@/server/services/homework";
import { addDays, isoDate } from "@/lib/time";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createHomeworkAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("homework"))("new") };
}

export default async function NewHomeworkPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "homework.write"));
  if (!ctx) return <Forbidden />;
  const [t, assignments] = await Promise.all([getTranslations("homework"), myAssignments(ctx)]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("new")} description={t("newIntro")} />
      {assignments.length === 0 ? (
        <Alert>{t("noAssignment")}</Alert>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <ActionForm action={createHomeworkAction} school={school} redirectTo={`/${school}/homework/{id}`}>
              <Field name="assignment" label={t("classSubject")}>
                <Select id="assignment" name="assignment" defaultValue="">
                  <option value="" disabled>
                    —
                  </option>
                  {assignments.map((a) => (
                    <option key={a.id} value={`${a.classId}|${a.subjectId}`}>
                      {a.class.name} — {a.subject.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="title" label={t("homeworkTitle")}>
                <Input id="title" name="title" required placeholder={t("titlePlaceholder")} />
              </Field>
              <Field name="instructions" label={t("instructions")}>
                <Textarea id="instructions" name="instructions" required className="min-h-32" />
              </Field>
              <Field name="dueAt" label={t("dueAt")}>
                <Input
                  id="dueAt"
                  name="dueAt"
                  type="datetime-local"
                  required
                  defaultValue={`${isoDate(addDays(new Date(), 2))}T08:00`}
                />
              </Field>
              <Field name="link" label={t("link")}>
                <Input id="link" name="link" type="url" placeholder="https://" />
              </Field>
              <Field name="files" label={t("attachments")} hint={t("attachmentsHint")}>
                <Input
                  id="files"
                  name="files[]"
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="pt-3"
                />
              </Field>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="allowSubmission" className="accent-primary size-5" />
                {t("allowSubmission")}
              </label>
              <SubmitButton size="lg" className="self-start">
                {t("publish")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
