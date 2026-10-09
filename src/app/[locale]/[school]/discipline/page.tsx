import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listIncidents } from "@/server/services/discipline";
import { getActiveYear } from "@/server/services/structure";
import { isoDate } from "@/lib/time";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createIncidentAction, deleteIncidentAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("discipline"))("title") };
}

const TYPES = ["INCIDENT", "WARNING", "SANCTION", "SUMMONS"] as const;

export default async function DisciplinePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "discipline.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const canWrite = canAll(ctx.scope, "discipline.write");
  const [t, { items, total, page }, year] = await Promise.all([
    getTranslations("discipline"),
    listIncidents(ctx, { page: Number(sp.page) || 1 }),
    getActiveYear(ctx),
  ]);
  const classes = canWrite
    ? await ctx.db.class.findMany({
        where: { academicYearId: year?.id ?? "" },
        include: {
          enrollments: {
            where: { status: "ACTIVE", deletedAt: null },
            include: { student: true },
            orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
          },
        },
        orderBy: { name: "asc" },
      })
    : [];
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} />
      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>{t("new")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("notifyHint")}</p>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createIncidentAction}
              school={school}
              resetOnSuccess
              successMessage={t("saved")}
              className="grid gap-4 sm:grid-cols-3"
            >
              <Field name="studentId" label={t("student")} className="sm:col-span-2">
                <Select id="studentId" name="studentId" defaultValue="">
                  <option value="" disabled>
                    —
                  </option>
                  {classes.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {c.enrollments.map((e) => (
                        <option key={e.studentId} value={e.studentId}>
                          {e.student.lastName} {e.student.firstName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field name="type" label={t("type")}>
                <Select id="type" name="type" defaultValue="INCIDENT">
                  {TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`types.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="date" label={t("date")}>
                <Input id="date" name="date" type="date" defaultValue={isoDate(new Date())} />
              </Field>
              <Field name="description" label={t("description")} className="sm:col-span-2">
                <Textarea id="description" name="description" required className="min-h-16" />
              </Field>
              <Field name="sanction" label={t("sanction")} className="sm:col-span-3">
                <Input id="sanction" name="sanction" />
              </Field>
              <SubmitButton className="self-start">{t("save")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
      <Card className="divide-y p-0">
        {items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("empty")}</p>}
        {items.map((i) => (
          <div key={i.id} className="flex items-start gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1">
              <p>
                <Badge variant={i.type === "INCIDENT" ? "outline" : i.type === "SANCTION" ? "destructive" : "warning"}>
                  {t(`types.${i.type}`)}
                </Badge>{" "}
                <Link
                  href={`/${school}/students/${i.studentId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {i.student.lastName} {i.student.firstName}
                </Link>{" "}
                · {fmt.format(i.date)}
              </p>
              <p className="mt-1">{i.description}</p>
              {i.sanction && <p className="text-muted-foreground">{i.sanction}</p>}
            </div>
            {canWrite && (
              <ActionButton
                action={deleteIncidentAction}
                school={school}
                fields={{ id: i.id }}
                confirm={t("deleteConfirm")}
                variant="ghost"
                size="icon"
              >
                <Trash2 aria-label={t("delete")} />
              </ActionButton>
            )}
          </div>
        ))}
      </Card>
      <Pagination basePath={`/${school}/discipline`} page={page} total={total} params={{}} />
    </div>
  );
}
