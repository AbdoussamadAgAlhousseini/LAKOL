import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadSchoolPage, loadOrDeny } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { currentTerm, termsOfActiveYear } from "@/server/services/assessments";
import { councilSheet } from "@/server/services/report-cards";
import { formatScore } from "@/lib/grades";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { ExportLink } from "@/components/layout/export-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, Td, Th } from "@/components/ui/table";
import { saveAppraisalsAction, saveCouncilAction } from "../../actions";

const DISTINCTIONS = ["CONGRATULATIONS", "HONOR_ROLL", "ENCOURAGEMENT", "WORK_WARNING", "CONDUCT_WARNING"] as const;
const DECISIONS = ["PROMOTED", "CONDITIONAL", "REPEAT", "EXPELLED"] as const;

export default async function ClassResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string; classId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { locale, school, classId } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const terms = await termsOfActiveYear(ctx);
  const term = terms.find((x) => x.id === sp.term) ?? (await currentTerm(ctx));
  if (!term) return <Forbidden />;
  const sheet = await loadOrDeny(councilSheet(ctx, { classId, termId: term.id }));
  if (!sheet) return <Forbidden />;
  const t = await getTranslations("grades");
  const f = (v: number | null) => formatScore(v, locale);
  const ids = sheet.students.map((s) => s.studentId).join(",");
  const council = canAll(ctx.scope, "council.manage");
  const mySubjects = ctx.staffId
    ? await ctx.db.teachingAssignment.findMany({ where: { classId, staffId: ctx.staffId }, include: { subject: true } })
    : [];
  const appraisal = (studentId: string, subjectId: string) =>
    sheet.appraisals.find((a) => a.studentId === studentId && a.subjectId === subjectId)?.comment ?? "";
  const ranked = [...sheet.students].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const card = (studentId: string) => sheet.cards.find((c) => c.studentId === studentId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${sheet.class.name} — ${term.name}`}
        description={t("classStats", {
          average: f(sheet.classStats.average),
          highest: f(sheet.classStats.highest),
          lowest: f(sheet.classStats.lowest),
          scale: sheet.scale,
        })}
        actions={
          <ExportLink href={`/api/schools/${school}/exports/class-results?classId=${classId}&termId=${term.id}`} />
        }
      />
      <nav className="flex flex-wrap gap-2">
        {terms.map((x) => (
          <Link
            key={x.id}
            href={`/${school}/grades/class/${classId}?term=${x.id}`}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              x.id === term.id && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {x.name}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>{t("ranking")}</CardTitle>
          {!sheet.locked && <p className="text-warning-foreground text-sm">{t("notValidatedYet")}</p>}
        </CardHeader>
        <CardContent className="p-0">
          <Table data-testid="ranking">
            <thead>
              <tr>
                <Th>{t("rank")}</Th>
                <Th>{t("student")}</Th>
                <Th className="text-right">{t("average")}</Th>
                {sheet.subjects.map((s) => (
                  <Th key={s.id} className="text-right" title={s.name}>
                    {s.name.slice(0, 6)}
                    <span className="block text-[10px] font-normal">×{s.coefficient}</span>
                  </Th>
                ))}
                <Th>{t("reportCard")}</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((s) => (
                <tr key={s.studentId}>
                  <Td className="tabular-nums">{s.rank ?? "—"}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    {s.lastName} {s.firstName}
                  </Td>
                  <Td
                    className={cn(
                      "text-right font-bold tabular-nums",
                      s.average !== null && s.average < sheet.scale * 50 && "text-destructive",
                    )}
                  >
                    {f(s.average)}
                  </Td>
                  {s.subjects.map((x) => (
                    <Td key={x.subjectId} className="text-right tabular-nums">
                      {f(x.average)}
                    </Td>
                  ))}
                  <Td>
                    {card(s.studentId)?.documentId ? (
                      <a
                        href={`/api/files/${card(s.studentId)!.documentId}`}
                        target="_blank"
                        className="text-primary inline-flex items-center gap-1 underline"
                      >
                        <FileText className="size-4" /> PDF
                      </a>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      {mySubjects.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle>{t("subjectAppraisals", { subject: a.subject.name })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveAppraisalsAction} school={school} successMessage={t("saved")}>
              <input type="hidden" name="termId" value={term.id} />
              <input type="hidden" name="subjectId" value={a.subjectId} />
              <input type="hidden" name="students" value={ids} />
              {sheet.students.map((s) => {
                const avg = s.subjects.find((x) => x.subjectId === a.subjectId)?.average ?? null;
                return (
                  <div key={s.studentId} className="grid gap-1 sm:grid-cols-[14rem_4rem_1fr] sm:items-center">
                    <label htmlFor={`sa-${a.subjectId}-${s.studentId}`} className="text-sm font-medium">
                      {s.lastName} {s.firstName}
                    </label>
                    <span className="text-muted-foreground text-sm tabular-nums">{f(avg)}</span>
                    <Input
                      id={`sa-${a.subjectId}-${s.studentId}`}
                      name={`appr_${s.studentId}`}
                      defaultValue={appraisal(s.studentId, a.subjectId)}
                      maxLength={300}
                      className="h-10"
                    />
                  </div>
                );
              })}
              <SubmitButton size="sm" className="self-start">
                {t("saveAppraisals")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      ))}

      {(sheet.isHead || council) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("generalAppraisals")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveAppraisalsAction} school={school} successMessage={t("saved")}>
              <input type="hidden" name="termId" value={term.id} />
              <input type="hidden" name="students" value={ids} />
              {ranked.map((s) => (
                <div key={s.studentId} className="grid gap-1 sm:grid-cols-[14rem_4rem_1fr] sm:items-center">
                  <label htmlFor={`ga-${s.studentId}`} className="text-sm font-medium">
                    {s.lastName} {s.firstName}
                  </label>
                  <span className="text-sm font-semibold tabular-nums">{f(s.average)}</span>
                  <Input
                    id={`ga-${s.studentId}`}
                    name={`appr_${s.studentId}`}
                    defaultValue={appraisal(s.studentId, "")}
                    maxLength={500}
                    className="h-10"
                  />
                </div>
              ))}
              <SubmitButton size="sm" className="self-start">
                {t("saveAppraisals")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      {council && (
        <Card>
          <CardHeader>
            <CardTitle>{t("council")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("councilHint")}</p>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveCouncilAction} school={school} successMessage={t("saved")}>
              <input type="hidden" name="termId" value={term.id} />
              <input type="hidden" name="students" value={ids} />
              {ranked.map((s) => {
                const d = sheet.decisions.find((x) => x.studentId === s.studentId);
                const distinction = d ? (d.distinction ?? "") : (s.suggested ?? "");
                return (
                  <div
                    key={s.studentId}
                    className="grid gap-2 sm:grid-cols-[14rem_4rem_1fr_1fr] sm:items-center"
                    data-testid="council-row"
                  >
                    <span className="text-sm font-medium">
                      {s.lastName} {s.firstName}
                      {!d && s.suggested && (
                        <Badge variant="secondary" className="ml-2">
                          {t("suggested")}
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{f(s.average)}</span>
                    <Select
                      name={`distinction_${s.studentId}`}
                      defaultValue={distinction}
                      aria-label={`${t("distinction")} ${s.lastName}`}
                      className="h-10"
                    >
                      <option value="">{t("noDistinction")}</option>
                      {DISTINCTIONS.map((x) => (
                        <option key={x} value={x}>
                          {t(`distinctions.${x}`)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      name={`decision_${s.studentId}`}
                      defaultValue={d?.decision ?? ""}
                      aria-label={`${t("decision")} ${s.lastName}`}
                      className="h-10"
                    >
                      <option value="">{t("noDecision")}</option>
                      {DECISIONS.map((x) => (
                        <option key={x} value={x}>
                          {t(`decisions.${x}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              })}
              <SubmitButton size="sm" className="self-start">
                {t("saveCouncil")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
