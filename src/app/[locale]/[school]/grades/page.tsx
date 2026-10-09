import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can, canAll } from "@/server/rbac/policies";
import type { SchoolContext } from "@/server/context";
import { currentTerm, listAssessments, studentResults, termsOfActiveYear } from "@/server/services/assessments";
import { myAssignments } from "@/server/services/homework";
import { getActiveYear } from "@/server/services/structure";
import { formatScore } from "@/lib/grades";
import { isoDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createAssessmentAction, validateClassTermAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("grades"))("title") };
}

type Term = { id: string; name: string; isLocked: boolean };
type Props = { ctx: SchoolContext; school: string; locale: string; term: Term };

export default async function GradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "grade.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const t = await getTranslations("grades");
  const terms = await termsOfActiveYear(ctx);
  const term = terms.find((x) => x.id === sp.term) ?? (await currentTerm(ctx));
  if (!term) return <Alert>{t("noTerm")}</Alert>;
  const props = { ctx, school, locale, term };
  const isTeacher = ctx.scope.permissions.has("grade.write:own") && Boolean(ctx.staffId);

  return (
    <>
      <PageHeader title={t("title")} />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label={t("terms")}>
        {terms.map((x) => (
          <Link
            key={x.id}
            href={`/${school}/grades?term=${x.id}`}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              x.id === term.id && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {x.name}
            {x.isLocked && <Lock className="ml-1 inline size-3" aria-label={t("locked")} />}
          </Link>
        ))}
      </nav>
      <div className="flex flex-col gap-6">
        {canAll(ctx.scope, "grade.read") && <SchoolOverview {...props} />}
        {isTeacher && <TeacherSection {...props} />}
        {!canAll(ctx.scope, "grade.read") && !isTeacher && <FamilySection {...props} />}
      </div>
    </>
  );
}

/** Direction : avancement de la saisie et validation par classe. */
async function SchoolOverview({ ctx, school, term }: Props) {
  const t = await getTranslations("grades");
  const year = await getActiveYear(ctx);
  const classes = await ctx.db.class.findMany({
    where: { academicYearId: year?.id ?? "" },
    include: {
      assessments: { where: { termId: term.id }, select: { isLocked: true, subjectId: true } },
      teachingAssignments: { select: { subjectId: true } },
    },
    orderBy: { name: "asc" },
  });
  const canValidate = canAll(ctx.scope, "grade.validate");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("overview", { term: term.name })}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {classes.map((c) => {
            const covered = new Set(c.assessments.map((a) => a.subjectId)).size;
            const total = c.teachingAssignments.length;
            const locked = c.assessments.length > 0 && c.assessments.every((a) => a.isLocked);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="class-progress">
                <Link
                  href={`/${school}/grades/class/${c.id}?term=${term.id}`}
                  className="min-w-20 font-semibold underline-offset-4 hover:underline"
                >
                  {c.name}
                </Link>
                <span className="text-muted-foreground text-sm">
                  {t("progress", { covered, total, count: c.assessments.length })}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {locked ? (
                    <Badge variant="success">
                      <Lock className="size-3" /> {t("validated")}
                    </Badge>
                  ) : (
                    canValidate &&
                    c.assessments.length > 0 && (
                      <ActionButton
                        action={validateClassTermAction}
                        school={school}
                        fields={{ classId: c.id, termId: term.id }}
                        confirm={t("validateConfirm")}
                      >
                        {t("validate")}
                      </ActionButton>
                    )
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Professeur : ses évaluations et la création rapide. */
async function TeacherSection({ ctx, school, locale, term }: Props) {
  const t = await getTranslations("grades");
  const [assessments, assignments] = await Promise.all([listAssessments(ctx, { termId: term.id }), myAssignments(ctx)]);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const sizes = new Map(
    (
      await ctx.db.enrollment.groupBy({
        by: ["classId"],
        where: { classId: { in: assignments.map((a) => a.classId) }, status: "ACTIVE", deletedAt: null },
        _count: { _all: true },
      })
    ).map((g) => [g.classId, g._count._all]),
  );
  const headOf = await ctx.db.class.findMany({
    where: { headTeacherId: ctx.staffId ?? "" },
    select: { id: true, name: true },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("myAssessments")}</CardTitle>
          {headOf.length > 0 && (
            <p className="text-sm">
              {headOf.map((c) => (
                <Link
                  key={c.id}
                  href={`/${school}/grades/class/${c.id}?term=${term.id}`}
                  className="text-primary mr-3 underline"
                >
                  {t("councilOf", { name: c.name })}
                </Link>
              ))}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {assessments.length === 0 && <p className="text-muted-foreground px-5 pb-5 text-sm">{t("noAssessment")}</p>}
          <ul className="divide-y">
            {assessments
              .filter((a) => assignments.some((x) => x.classId === a.classId && x.subjectId === a.subjectId))
              .map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/${school}/grades/${a.id}`}
                    className="hover:bg-accent flex items-center gap-3 px-5 py-3"
                    data-testid="assessment-row"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.title}</span>
                      <span className="text-muted-foreground text-sm">
                        {a.class.name} · {a.subject.name} · {t(`types.${a.type}`)} · {fmt.format(a.date)} · /{a.outOf} ·
                        ×{a.weight}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums">
                      {a._count.grades}/{sizes.get(a.classId) ?? 0}
                    </span>
                    {a.isLocked && <Lock className="text-muted-foreground size-4" aria-label={t("locked")} />}
                  </Link>
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>

      {assignments.length > 0 && !term.isLocked && (
        <Card>
          <CardHeader>
            <CardTitle>{t("newAssessment")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createAssessmentAction}
              school={school}
              redirectTo={`/${school}/grades/{id}`}
              className="grid gap-3 sm:grid-cols-3"
            >
              <input type="hidden" name="termId" value={term.id} />
              <Field name="assignment" label={t("classSubject")} className="sm:col-span-2">
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
              <Field name="type" label={t("type")}>
                <Select id="type" name="type" defaultValue="QUIZ">
                  {(["QUIZ", "HOMEWORK", "COMPOSITION", "MOCK_EXAM"] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`types.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="title" label={t("assessmentTitle")} className="sm:col-span-2">
                <Input id="title" name="title" required placeholder={t("titlePlaceholder")} />
              </Field>
              <Field name="date" label={t("date")}>
                <Input id="date" name="date" type="date" defaultValue={isoDate(new Date())} />
              </Field>
              <Field name="outOf" label={t("outOf")}>
                <Select id="outOf" name="outOf" defaultValue={String(ctx.school.gradingScale)}>
                  <option value="20">20</option>
                  <option value="10">10</option>
                </Select>
              </Field>
              <Field name="weight" label={t("weight")} hint={t("weightHint")}>
                <Input id="weight" name="weight" type="number" min={1} max={10} defaultValue={1} />
              </Field>
              <SubmitButton className="self-end">{t("createAndGrade")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Parent / élève : notes et moyennes de la période, par matière. */
async function FamilySection({ ctx, locale, term }: Props) {
  const t = await getTranslations("grades");
  const students = await ctx.db.student.findMany({
    where: { id: { in: [...ctx.scope.studentIds] } },
    orderBy: { firstName: "asc" },
  });
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <>
      {await Promise.all(
        students.map(async (s) => {
          let results;
          try {
            results = await studentResults(ctx, { studentId: s.id, termId: term.id });
          } catch {
            return (
              <Alert key={s.id}>
                {s.firstName} : {t("hidden")}
              </Alert>
            );
          }
          const me = results?.student;
          if (!results || !me) return null;
          return (
            <Card key={s.id} data-testid="family-grades">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {s.firstName} {s.lastName}{" "}
                    <span className="text-muted-foreground text-sm font-normal">{results.class.name}</span>
                  </span>
                  {me.average !== null && (
                    <span className="text-primary text-2xl">
                      {formatScore(me.average, locale)}/{results.scale}
                    </span>
                  )}
                </CardTitle>
                {me.rank && (
                  <p className="text-muted-foreground text-sm">{t("rankOf", { rank: me.rank, size: results.size })}</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {me.subjects.map((x) => (
                  <div key={x.subjectId} className="rounded-lg border p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {x.name} <span className="text-muted-foreground text-xs">coef. {x.coefficient}</span>
                      </span>
                      <span
                        className={cn(
                          "text-lg font-bold tabular-nums",
                          x.average !== null && x.average < results.scale * 50 && "text-destructive",
                        )}
                      >
                        {formatScore(x.average, locale)}
                      </span>
                    </div>
                    <ul className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-sm">
                      {x.grades.map((g, i) => (
                        <li key={i} className="bg-muted rounded px-2 py-0.5">
                          {fmt.format(g.date)} ·{" "}
                          {g.absent
                            ? t("absent")
                            : g.score === null
                              ? "—"
                              : `${formatScore(g.score, locale)}/${g.outOf}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        }),
      )}
    </>
  );
}
