import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BookText, Paperclip, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { homeworkLoad, listHomework } from "@/server/services/homework";
import { classOptions } from "@/server/services/options";
import { dayStart } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HomeworkStatus } from "./status";
import { markDoneAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("homework"))("title") };
}

export default async function HomeworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ classId?: string; past?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "homework.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const past = sp.past === "1";
  const [t, data] = await Promise.all([
    getTranslations("homework"),
    listHomework(ctx, { classId: sp.classId, upcoming: !past, page: Number(sp.page) || 1 }),
  ]);
  const base = `/${school}/homework`;
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const isTeacher = can(ctx.scope, "homework.write");
  const canSubmit = can(ctx.scope, "homework.submit");

  const tabs = (
    <nav className="mb-4 flex gap-2">
      {[false, true].map((p) => (
        <Link
          key={String(p)}
          href={`${base}?${new URLSearchParams({ ...(sp.classId ? { classId: sp.classId } : {}), ...(p ? { past: "1" } : {}) })}`}
          className={cn(
            "rounded-full border px-4 py-2 text-sm",
            p === past && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {p ? t("past") : t("upcoming")}
        </Link>
      ))}
    </nav>
  );

  if (data.mode === "family") {
    return (
      <>
        <PageHeader title={t("title")} />
        {tabs}
        <div className="flex flex-col gap-6">
          {data.children.map(({ student, items }) => (
            <section key={student.id} className="flex flex-col gap-3">
              {data.children.length > 1 || ctx.activeRole === "PARENT" ? (
                <h2 className="text-lg font-semibold">
                  {student.firstName} {student.lastName}
                </h2>
              ) : null}
              {items.length === 0 && <p className="text-muted-foreground">{t("nothing")}</p>}
              {items.map((h) => {
                const done = h.submission && h.submission.status !== "TODO";
                return (
                  <Card key={h.id} data-testid="homework-item">
                    <CardContent className="flex items-start gap-3 pt-5">
                      <div
                        className="h-full w-1 self-stretch rounded"
                        style={{ backgroundColor: h.subject.color ?? "var(--primary)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <Link href={`${base}/${h.id}`} className="font-semibold underline-offset-4 hover:underline">
                          {h.title}
                        </Link>
                        <p className="text-muted-foreground text-sm">
                          {h.subject.name} · {t("due", { date: fmt.format(h.dueAt) })}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <HomeworkStatus status={h.submission?.status ?? "TODO"} />
                          {h.allowSubmission && (
                            <span className="text-muted-foreground text-xs">{t("onlineSubmission")}</span>
                          )}
                        </div>
                      </div>
                      {canSubmit &&
                        !past &&
                        (h.submission?.status ?? "TODO") !== "SUBMITTED" &&
                        h.submission?.status !== "GRADED" && (
                          <ActionForm action={markDoneAction} school={school} className="gap-0">
                            <input type="hidden" name="homeworkId" value={h.id} />
                            <input type="hidden" name="studentId" value={student.id} />
                            {!done && <input type="hidden" name="done" value="on" />}
                            <SubmitButton size="sm" variant={done ? "outline" : "default"}>
                              {done ? t("undo") : t("markDone")}
                            </SubmitButton>
                          </ActionForm>
                        )}
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          ))}
        </div>
      </>
    );
  }

  const classes = (await classOptions(ctx)).filter(
    (c) => can(ctx.scope, "student.read") || ctx.scope.classIds.has(c.id),
  );
  const load = sp.classId ? await homeworkLoad(ctx, sp.classId, dayStart(), 14) : null;
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "narrow", day: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          isTeacher && (
            <>
              <Button variant="outline" asChild>
                <Link href={`${base}/lessons`}>
                  <BookText /> {t("lessons")}
                </Link>
              </Button>
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus /> {t("new")}
                </Link>
              </Button>
            </>
          )
        }
      />
      {tabs}
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("filterClass")}>
        <Link
          href={past ? `${base}?past=1` : base}
          className={cn("rounded-full border px-3 py-1.5 text-sm", !sp.classId && "bg-secondary")}
        >
          {t("allClasses")}
        </Link>
        {classes.map((c) => (
          <Link
            key={c.id}
            href={`${base}?classId=${c.id}${past ? "&past=1" : ""}`}
            className={cn("rounded-full border px-3 py-1.5 text-sm", sp.classId === c.id && "bg-secondary")}
          >
            {c.name}
          </Link>
        ))}
      </nav>

      {load && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("load")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid grid-cols-7 gap-1 text-center text-xs sm:grid-cols-14">
              {load.map((d) => (
                <li
                  key={d.date.toISOString()}
                  title={d.items.map((i) => `${i.subject} : ${i.title}`).join("\n")}
                  className={cn(
                    "rounded p-1",
                    d.items.length === 0
                      ? "bg-muted"
                      : d.items.length < 3
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                  )}
                >
                  <span className="block opacity-70">{dayFmt.format(d.date)}</span>
                  <span className="text-base font-bold">{d.items.length}</span>
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground mt-2 text-xs">{t("loadHint")}</p>
          </CardContent>
        </Card>
      )}

      {data.items.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">{t("nothing")}</p>
      ) : (
        <Card className="divide-y p-0">
          {data.items.map((h) => (
            <Link
              key={h.id}
              href={`${base}/${h.id}`}
              className="hover:bg-accent flex items-center gap-3 p-4"
              data-testid="homework-item"
            >
              <div className="h-10 w-1 rounded" style={{ backgroundColor: h.subject.color ?? "var(--primary)" }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{h.title}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {h.class.name} · {h.subject.name} · {t("due", { date: fmt.format(h.dueAt) })}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {t("doneCount", { done: h._count.submissions, total: h.class._count.enrollments })}
              </span>
              {h.allowSubmission && (
                <Paperclip className="text-muted-foreground size-4" aria-label={t("onlineSubmission")} />
              )}
            </Link>
          ))}
        </Card>
      )}
      <Pagination
        basePath={base}
        page={data.page}
        total={data.total}
        params={{ classId: sp.classId, past: past ? "1" : undefined }}
      />
    </>
  );
}
