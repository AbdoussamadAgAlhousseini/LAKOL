import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FileText, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can, canAll } from "@/server/rbac/policies";
import type { SchoolContext } from "@/server/context";
import { currentTerm, mockExamStats, termsOfActiveYear } from "@/server/services/assessments";
import { familyReportCards } from "@/server/services/report-cards";
import { getActiveYear } from "@/server/services/structure";
import { formatScore } from "@/lib/grades";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { validateClassTermAction } from "../grades/actions";
import { generateReportCardsAction, publishReportCardsAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("reportCards"))("title") };
}

export default async function ReportCardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(
    school,
    locale,
    (c) => can(c.scope, "grade.read") || can(c.scope, "reportcard.publish"),
  );
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("reportCards");
  if (!canAll(ctx.scope, "grade.read")) {
    return ctx.scope.classIds.size > 0 ? (
      <TeacherView ctx={ctx} school={school} />
    ) : (
      <FamilyView ctx={ctx} locale={locale} />
    );
  }

  const sp = await searchParams;
  const terms = await termsOfActiveYear(ctx);
  const term = terms.find((x) => x.id === sp.term) ?? (await currentTerm(ctx));
  if (!term) return <Alert>{t("noTerm")}</Alert>;
  const year = await getActiveYear(ctx);
  const [classes, exams] = await Promise.all([
    ctx.db.class.findMany({
      where: { academicYearId: year?.id ?? "" },
      include: {
        assessments: { where: { termId: term.id }, select: { isLocked: true } },
        reportCards: { where: { termId: term.id }, select: { status: true } },
        _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
      },
      orderBy: { name: "asc" },
    }),
    mockExamStats(ctx),
  ]);
  const canPublish = canAll(ctx.scope, "reportcard.publish");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <nav className="flex flex-wrap gap-2">
        {terms.map((x) => (
          <Link
            key={x.id}
            href={`/${school}/report-cards?term=${x.id}`}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              x.id === term.id && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {x.name}
          </Link>
        ))}
      </nav>
      <Card className="divide-y p-0">
        {classes.map((c) => {
          const locked = c.assessments.length > 0 && c.assessments.every((a) => a.isLocked);
          const published = c.reportCards.filter((r) => r.status === "PUBLISHED").length;
          const ready = c.reportCards.filter((r) => r.status === "VALIDATED").length;
          const step = !c.assessments.length
            ? "noGrades"
            : !locked
              ? "toValidate"
              : !c.reportCards.length
                ? "toGenerate"
                : ready > 0
                  ? "toPublish"
                  : "published";
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 p-4" data-testid="report-class">
              <Link
                href={`/${school}/grades/class/${c.id}?term=${term.id}`}
                className="min-w-20 font-semibold underline-offset-4 hover:underline"
              >
                {c.name}
              </Link>
              <Badge variant={step === "published" ? "success" : step === "noGrades" ? "secondary" : "warning"}>
                {t(`steps.${step}`)}
              </Badge>
              <span className="text-muted-foreground text-sm">
                {t("counts", { published, total: c._count.enrollments })}
              </span>
              {canPublish && (
                <span className="ml-auto flex flex-wrap gap-2">
                  {step === "toValidate" && (
                    <ActionButton
                      action={validateClassTermAction}
                      school={school}
                      fields={{ classId: c.id, termId: term.id }}
                      confirm={t("validateConfirm")}
                    >
                      <Lock /> {t("validate")}
                    </ActionButton>
                  )}
                  {locked && (
                    <ActionButton
                      action={generateReportCardsAction}
                      school={school}
                      fields={{ classId: c.id, termId: term.id }}
                      variant={step === "toGenerate" ? "default" : "outline"}
                    >
                      <FileText /> {c.reportCards.length ? t("regenerate") : t("generate")}
                    </ActionButton>
                  )}
                  {ready > 0 && (
                    <ActionButton
                      action={publishReportCardsAction}
                      school={school}
                      fields={{ classId: c.id, termId: term.id }}
                      confirm={t("publishConfirm")}
                      variant="default"
                    >
                      {t("publish")}
                    </ActionButton>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </Card>

      {exams.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("exams")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("examsHint")}</p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {exams.map((e) => (
              <div key={e.classId} className="rounded-lg border p-4" data-testid="exam-stats">
                <p className="font-semibold">
                  {e.className} — {e.exam}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("mockCount", { count: e.mockExams, candidates: e.candidates })}
                </p>
                {e.passRate !== null && (
                  <>
                    <p className="mt-2 text-2xl font-bold">{e.passRate} %</p>
                    <p className="text-muted-foreground text-sm">
                      {t("passRate")} · {t("average")} {formatScore(e.average, locale)}
                    </p>
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Professeur : accès aux résultats et bulletins de ses classes. */
async function TeacherView({ ctx, school }: { ctx: SchoolContext; school: string }) {
  const t = await getTranslations("reportCards");
  const term = await currentTerm(ctx);
  const classes = await ctx.db.class.findMany({
    where: { id: { in: [...ctx.scope.classIds] } },
    orderBy: { name: "asc" },
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} description={t("teacherIntro")} />
      <div className="grid gap-3 sm:grid-cols-3">
        {classes.map((c) => (
          <Link key={c.id} href={`/${school}/grades/class/${c.id}${term ? `?term=${term.id}` : ""}`}>
            <Card className="hover:bg-accent">
              <CardContent className="pt-5 font-semibold">{c.name}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Parent / élève : bulletins publiés à télécharger. */
async function FamilyView({ ctx, locale }: { ctx: SchoolContext; locale: string }) {
  const t = await getTranslations("reportCards");
  const cards = await familyReportCards(ctx);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} />
      {cards.length === 0 && <p className="text-muted-foreground">{t("none")}</p>}
      {cards.map((c) => (
        <Card key={c.id} data-testid="family-report-card">
          <CardContent className="flex flex-wrap items-center gap-3 pt-5">
            <FileText className="text-primary size-8" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {c.student.firstName} {c.student.lastName} — {c.term.name} {c.term.academicYear.name}
              </p>
              <p className="text-muted-foreground text-sm">
                {c.class.name}
                {c.publishedAt && ` · ${t("publishedOn", { date: fmt.format(c.publishedAt) })}`}
                {!c.blocked &&
                  !c.hiddenGrades &&
                  c.average !== null &&
                  ` · ${t("averageValue", { value: formatScore(c.average, locale) })}`}
              </p>
            </div>
            {c.blocked ? (
              <Alert variant="destructive" className="w-full">
                {t("blocked")}
              </Alert>
            ) : c.hiddenGrades ? (
              <span className="text-muted-foreground text-sm">{t("hidden")}</span>
            ) : (
              c.documentId && (
                <a
                  href={`/api/files/${c.documentId}`}
                  target="_blank"
                  className="bg-primary text-primary-foreground rounded-md px-4 py-3 font-medium"
                >
                  {t("download")}
                </a>
              )
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
