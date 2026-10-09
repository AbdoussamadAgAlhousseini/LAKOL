import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { LOAN_DAYS, listBooks, openLoans } from "@/server/services/modules/library";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { StudentSelect } from "@/components/forms/student-select";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { lendAction, returnAction, saveBookAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("library"))("title") };
}

export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "library.manage"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const [t, books, loans] = await Promise.all([
    getTranslations("library"),
    listBooks(ctx, { q, page: Number(sp.page) || 1 }),
    openLoans(ctx),
  ]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("hint", { days: LOAN_DAYS })} />
      <Card>
        <CardHeader>
          <CardTitle>{t("loans", { count: loans.length })}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0" data-testid="loans">
          {loans.length === 0 && <p className="text-muted-foreground px-6 py-4 text-sm">{t("noLoan")}</p>}
          {loans.map((l) => {
            const late = l.dueAt < now;
            return (
              <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
                <span className="min-w-0 flex-1 font-medium">{l.book.title}</span>
                <span>
                  {l.student
                    ? `${l.student.lastName} ${l.student.firstName}`
                    : `${l.staff?.lastName} ${l.staff?.firstName}`}
                </span>
                <span className={cn("text-xs", late ? "text-destructive font-semibold" : "text-muted-foreground")}>
                  {late ? t("lateSince", { date: date.format(l.dueAt) }) : t("dueOn", { date: date.format(l.dueAt) })}
                </span>
                <ActionButton action={returnAction} school={school} fields={{ id: l.id }}>
                  {t("return")}
                </ActionButton>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("addBook")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={saveBookAction}
            school={school}
            resetOnSuccess
            successMessage={t("saved")}
            className="grid gap-3 sm:grid-cols-3"
          >
            <Field name="title" label={t("bookTitle")} className="sm:col-span-2">
              <Input id="title" name="title" required maxLength={200} />
            </Field>
            <Field name="author" label={t("author")}>
              <Input id="author" name="author" maxLength={120} />
            </Field>
            <Field name="category" label={t("category")}>
              <Input id="category" name="category" maxLength={60} placeholder={t("categoryPlaceholder")} />
            </Field>
            <Field name="copies" label={t("copies")}>
              <Input id="copies" name="copies" type="number" min={1} defaultValue={1} />
            </Field>
            <Field name="location" label={t("location")}>
              <Input id="location" name="location" maxLength={60} />
            </Field>
            <SubmitButton className="self-start">{t("add")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder={t("search")} className="h-11" />
        <Button type="submit" variant="outline" size="icon" className="size-11" aria-label={t("search")}>
          <Search />
        </Button>
      </form>
      <Card className="divide-y p-0" data-testid="books">
        {books.items.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noBook")}</p>}
        {books.items.map((b) => (
          <details key={b.id} className="group">
            <summary className="hover:bg-accent flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{b.title}</span>
                <span className="text-muted-foreground block text-xs">
                  {[b.author, b.category, b.location].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Badge variant={b.available > 0 ? "success" : "destructive"}>
                {t("available", { available: b.available, copies: b.copies })}
              </Badge>
            </summary>
            {b.available > 0 && (
              <div className="px-4 pb-4">
                <ActionForm
                  action={lendAction}
                  school={school}
                  successMessage={t("lent")}
                  className="grid gap-2 sm:grid-cols-3"
                >
                  <input type="hidden" name="bookId" value={b.id} />
                  <Field name="studentId" label={t("borrower")} className="sm:col-span-2">
                    <StudentSelect ctx={ctx} id={`borrower-${b.id}`} />
                  </Field>
                  <Field name="days" label={t("days")}>
                    <Input id={`days-${b.id}`} name="days" type="number" min={1} max={90} defaultValue={LOAN_DAYS} />
                  </Field>
                  <SubmitButton size="sm" className="self-start">
                    {t("lend")}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
          </details>
        ))}
      </Card>
      <Pagination basePath={`/${school}/library`} page={books.page} total={books.total} params={{ q }} />
    </div>
  );
}
