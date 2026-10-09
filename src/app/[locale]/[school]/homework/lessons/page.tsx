import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { listLessons, myAssignments } from "@/server/services/homework";
import { isoDate } from "@/lib/time";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveLessonAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("homework"))("lessons") };
}

/** Cahier de textes : ce qui a été fait en classe, séance par séance. */
export default async function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ classId?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(
    school,
    locale,
    (c) => can(c.scope, "lesson.write") || c.scope.permissions.has("homework.read"),
  );
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [t, assignments, { items, total, page }] = await Promise.all([
    getTranslations("homework"),
    myAssignments(ctx),
    listLessons(ctx, { classId: sp.classId, page: Number(sp.page) || 1 }),
  ]);
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("lessons")} description={t("lessonsIntro")} />
      {assignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("newLesson")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={saveLessonAction}
              school={school}
              resetOnSuccess
              successMessage={t("lessonSaved")}
              className="grid gap-4 sm:grid-cols-2"
            >
              <Field name="assignment" label={t("classSubject")}>
                <Select id="lesson-assignment" name="assignment" defaultValue="">
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
              <Field name="date" label={t("lessonDate")}>
                <Input id="lesson-date" name="date" type="date" defaultValue={isoDate(new Date())} />
              </Field>
              <Field name="title" label={t("lessonTitle")} className="sm:col-span-2">
                <Input id="lesson-title" name="title" required />
              </Field>
              <Field name="content" label={t("lessonContent")} className="sm:col-span-2">
                <Textarea id="lesson-content" name="content" required className="min-h-28" />
              </Field>
              <SubmitButton className="self-start">{t("saveLesson")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
      {items.length === 0 && <p className="text-muted-foreground py-6 text-center">{t("noLesson")}</p>}
      <div className="flex flex-col gap-3">
        {items.map((l) => (
          <Card key={l.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{l.title}</CardTitle>
              <p className="text-muted-foreground text-sm first-letter:uppercase">
                {fmt.format(l.date)} · {l.class.name} · {l.subject.name} · {l.staff.firstName} {l.staff.lastName}
              </p>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-line">{l.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Pagination basePath={`/${school}/homework/lessons`} page={page} total={total} params={{ classId: sp.classId }} />
    </div>
  );
}
