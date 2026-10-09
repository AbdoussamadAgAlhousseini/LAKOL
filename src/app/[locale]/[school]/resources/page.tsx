import type { Metadata } from "next";
import type { ResourceType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { ExternalLink, FileText, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listResources, publishableSubjects } from "@/server/services/resources";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createResourceAction, deleteResourceAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("resources"))("title") };
}

const TYPES = ["COURSE", "EXERCISE", "CORRECTION", "PAST_EXAM"] as const;

export default async function ResourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ subject?: string; type?: string; q?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => c.scope.permissions.has("resource.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const type = TYPES.find((x) => x === sp.type) as ResourceType | undefined;
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const [t, { items, total, page }, publishable, subjects, levels] = await Promise.all([
    getTranslations("resources"),
    listResources(ctx, { subjectId: sp.subject, type, q, page: Number(sp.page) || 1 }),
    publishableSubjects(ctx),
    ctx.db.subject.findMany({ orderBy: { name: "asc" } }),
    ctx.db.level.findMany({ orderBy: { order: "asc" } }),
  ]);
  const isManager = canAll(ctx.scope, "school.structure.manage");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("hint")} />
      {publishable.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createResourceAction}
              school={school}
              resetOnSuccess
              successMessage={t("published")}
              className="grid gap-4 sm:grid-cols-3"
            >
              <Field name="title" label={t("titleField")} className="sm:col-span-3">
                <Input id="title" name="title" maxLength={160} required />
              </Field>
              <Field name="subjectId" label={t("subject")}>
                <Select id="subjectId" name="subjectId">
                  {publishable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="levelId" label={t("level")}>
                <Select id="levelId" name="levelId" defaultValue="">
                  <option value="">{t("allLevels")}</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="type" label={t("type")}>
                <Select id="type" name="type" defaultValue="COURSE">
                  {TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`types.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="description" label={t("description")} className="sm:col-span-3">
                <Textarea id="description" name="description" maxLength={1000} className="min-h-16" />
              </Field>
              <Field name="file" label={t("file")} hint={t("fileHint")}>
                <Input id="file" name="file" type="file" accept="application/pdf,image/*" />
              </Field>
              <Field name="url" label={t("link")} className="sm:col-span-2">
                <Input id="url" name="url" type="url" placeholder="https://" />
              </Field>
              <SubmitButton className="self-start">{t("publish")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <form className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder={t("search")} className="h-11 min-w-40 flex-1" />
        <Select name="subject" defaultValue={sp.subject ?? ""} aria-label={t("subject")} className="h-11 w-auto">
          <option value="">{t("allSubjects")}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={type ?? ""} aria-label={t("type")} className="h-11 w-auto">
          <option value="">{t("allTypes")}</option>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`types.${x}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" className="h-11">
          {t("filter")}
        </Button>
      </form>

      <Card className="divide-y p-0" data-testid="resources">
        {items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("empty")}</p>}
        {items.map((r) => (
          <div key={r.id} className="flex items-start gap-3 p-4 text-sm">
            <FileText className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.title}</p>
              <p className="text-muted-foreground text-xs">
                {r.subject.name} · {r.level?.name ?? t("allLevels")} · {date.format(r.createdAt)}
              </p>
              {r.description && <p className="mt-1 whitespace-pre-wrap">{r.description}</p>}
              <div className="mt-2 flex flex-wrap gap-3">
                {r.documentId && (
                  <a href={`/api/files/${r.documentId}`} target="_blank" className="text-primary underline">
                    {t("open")}
                  </a>
                )}
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-1 underline"
                  >
                    <ExternalLink className="size-3" aria-hidden /> {t("openLink")}
                  </a>
                )}
              </div>
            </div>
            <Badge variant="secondary" className={cn(r.type === "PAST_EXAM" && "bg-primary/10 text-primary")}>
              {t(`types.${r.type}`)}
            </Badge>
            {(r.createdById === ctx.user.id || isManager) && (
              <ActionButton
                action={deleteResourceAction}
                school={school}
                fields={{ id: r.id }}
                variant="ghost"
                confirm={t("confirmDelete")}
              >
                <Trash2 aria-hidden />
                <span className="sr-only">{t("delete")}</span>
              </ActionButton>
            )}
          </div>
        ))}
      </Card>
      <Pagination
        basePath={`/${school}/resources`}
        page={page}
        total={total}
        params={{ subject: sp.subject, type, q }}
      />
      <Link href={`/${school}/homework`} className="text-primary text-sm underline">
        {t("seeHomework")}
      </Link>
    </div>
  );
}
