import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClipboardCheck, FileText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can, canAll } from "@/server/rbac/policies";
import type { SchoolContext } from "@/server/context";
import { attendanceStats, listAbsences, myTodaySlots } from "@/server/services/attendance";
import { listIncidents } from "@/server/services/discipline";
import { classOptions } from "@/server/services/options";
import { addDays, dayStart, formatTime, isoDate, parseIsoDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { reviewJustificationAction, submitJustificationAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("attendance"))("title") };
}

type Props = {
  ctx: SchoolContext;
  school: string;
  locale: string;
  sp: { date?: string; classId?: string; pending?: string; page?: string };
};

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<Props["sp"]>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "attendance.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const t = await getTranslations("attendance");
  const props = { ctx, school, locale, sp };
  const isTeacher = ctx.scope.permissions.has("attendance.write:own") && Boolean(ctx.staffId);
  const isFamily = !canAll(ctx.scope, "attendance.read") && !isTeacher;

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="flex flex-col gap-6">
        {isTeacher && <TeacherSection {...props} />}
        {canAll(ctx.scope, "attendance.write") && <CallAnyClass {...props} />}
        {isFamily ? <FamilySection {...props} /> : <AbsenceList {...props} />}
      </div>
    </>
  );
}

async function TeacherSection({ ctx, school, locale }: Props) {
  const t = await getTranslations("attendance");
  const slots = await myTodaySlots(ctx);
  const today = isoDate(dayStart());
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("todayCourses")}</CardTitle>
        <p className="text-muted-foreground text-sm first-letter:uppercase">{fmt.format(new Date())}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {slots.length === 0 && <p className="text-muted-foreground text-sm">{t("noCourseToday")}</p>}
        {slots.map((s) => {
          const cancelled = s.exceptions.some((e) => e.kind === "CANCELLED");
          return (
            <Link
              key={s.id}
              href={`/${school}/attendance/call?classId=${s.classId}&slotId=${s.id}&date=${today}`}
              className={cn(
                "hover:bg-accent flex min-h-14 items-center gap-3 rounded-lg border p-3",
                cancelled && "pointer-events-none opacity-50",
              )}
              data-testid="today-slot"
            >
              <ClipboardCheck className="text-primary size-6" aria-hidden />
              <span className="flex-1">
                <span className="block font-semibold">
                  {s.class.name} — {s.subject.name}
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {formatTime(s.startMin)}–{formatTime(s.endMin)}
                </span>
              </span>
              {cancelled ? (
                <Badge variant="destructive">{t("cancelled")}</Badge>
              ) : (
                <span className="text-primary text-sm font-medium">{t("takeCall")}</span>
              )}
            </Link>
          );
        })}
        <CallForm ctx={ctx} school={school} locale={locale} onlyOwn />
      </CardContent>
    </Card>
  );
}

async function CallAnyClass({ ctx, school, locale }: Props) {
  const t = await getTranslations("attendance");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("callAnyClass")}</CardTitle>
      </CardHeader>
      <CardContent>
        <CallForm ctx={ctx} school={school} locale={locale} />
      </CardContent>
    </Card>
  );
}

/** Appel sans créneau (journée) : formulaire GET vers la feuille d'appel. */
async function CallForm({
  ctx,
  school,
  locale,
  onlyOwn,
}: {
  ctx: SchoolContext;
  school: string;
  locale: string;
  onlyOwn?: boolean;
}) {
  const t = await getTranslations("attendance");
  const classes = (await classOptions(ctx)).filter((c) => !onlyOwn || ctx.scope.classIds.has(c.id));
  return (
    <form action={`/${locale}/${school}/attendance/call`} className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
      <Select name="classId" aria-label={t("class")} defaultValue={classes[0]?.id}>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Input
        name="date"
        type="date"
        aria-label={t("date")}
        defaultValue={isoDate(dayStart())}
        max={isoDate(dayStart())}
      />
      <Button type="submit" variant="outline" className="h-12">
        {t("dayCall")}
      </Button>
    </form>
  );
}

async function AbsenceList({ ctx, school, locale, sp }: Props) {
  const t = await getTranslations("attendance");
  const pendingOnly = sp.pending === "1";
  const date = parseIsoDate(sp.date);
  const { items, total, page } = await listAbsences(ctx, {
    classId: sp.classId,
    from: date ?? undefined,
    to: date ?? undefined,
    pendingOnly,
    page: Number(sp.page) || 1,
  });
  const reviewer = canAll(ctx.scope, "attendance.write");
  const today = canAll(ctx.scope, "attendance.read")
    ? await attendanceStats(ctx, { from: dayStart(), to: dayStart() })
    : null;
  const classes = await classOptions(ctx);
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const base = `/${school}/attendance`;

  return (
    <>
      {today && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["rate", today.rate === null ? "—" : `${today.rate} %`],
              ["absentToday", today.absent],
              ["lateToday", today.late],
              ["excusedToday", today.excused],
            ] as const
          ).map(([k, v]) => (
            <Card key={k}>
              <CardContent className="pt-5">
                <p className="text-2xl font-bold">{v}</p>
                <p className="text-muted-foreground text-sm">{t(k)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("absences")}</CardTitle>
          <form className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr_auto_auto]">
            <Input name="date" type="date" aria-label={t("date")} defaultValue={sp.date} />
            <Select name="classId" aria-label={t("class")} defaultValue={sp.classId ?? ""}>
              <option value="">{t("allClasses")}</option>
              {classes
                .filter((c) => canAll(ctx.scope, "attendance.read") || ctx.scope.classIds.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="pending"
                value="1"
                defaultChecked={pendingOnly}
                className="accent-primary size-5"
              />
              {t("pendingOnly")}
            </label>
            <Button type="submit" variant="secondary" className="h-12">
              {t("filter")}
            </Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 && <p className="text-muted-foreground px-5 pb-5 text-sm">{t("noAbsence")}</p>}
          <ul className="divide-y">
            {items.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-5 py-3 text-sm" data-testid="absence-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/${school}/students/${a.studentId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {a.student.lastName} {a.student.firstName}
                  </Link>
                  <span className="text-muted-foreground">
                    {a.class.name} · {fmt.format(a.date)}
                    {a.timetableSlot && ` ${formatTime(a.timetableSlot.startMin)}`}
                    {a.subject && ` · ${a.subject.name}`}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Badge variant={a.status === "ABSENT" ? "destructive" : "warning"}>
                      {t(`status.${a.status}`)}
                      {a.minutesLate ? ` ${a.minutesLate} min` : ""}
                    </Badge>
                    {a.justified && <Badge variant="success">{t("justified")}</Badge>}
                    {!a.justified && a.justificationSubmittedAt && <Badge variant="secondary">{t("toReview")}</Badge>}
                  </span>
                </div>
                {a.reason && <p className="text-muted-foreground">« {a.reason} »</p>}
                {a.documents.map((d) => (
                  <a
                    key={d.id}
                    href={`/api/files/${d.id}`}
                    target="_blank"
                    className="text-primary inline-flex items-center gap-1 underline"
                  >
                    <FileText className="size-4" /> {d.name}
                  </a>
                ))}
                {reviewer && !a.justified && (
                  <ActionForm
                    action={reviewJustificationAction}
                    school={school}
                    className="flex-row flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="attendanceId" value={a.id} />
                    <input type="hidden" name="accept" value="on" />
                    {!a.reason && (
                      <Input
                        name="reason"
                        aria-label={t("reason")}
                        placeholder={t("reason")}
                        className="h-10 max-w-xs"
                      />
                    )}
                    <SubmitButton size="sm" variant="outline">
                      {t("accept")}
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Pagination
        basePath={base}
        page={page}
        total={total}
        params={{ date: sp.date, classId: sp.classId, pending: pendingOnly ? "1" : undefined }}
      />
    </>
  );
}

async function FamilySection({ ctx, school, locale }: Props) {
  const t = await getTranslations("attendance");
  const td = await getTranslations("discipline");
  const students = await ctx.db.student.findMany({
    where: { id: { in: [...ctx.scope.studentIds] } },
    orderBy: { firstName: "asc" },
  });
  const from = addDays(dayStart(), -90);
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const canJustify = can(ctx.scope, "attendance.justify");

  return (
    <>
      {await Promise.all(
        students.map(async (s) => {
          const [stats, absences, incidents] = await Promise.all([
            attendanceStats(ctx, { studentId: s.id, from, to: dayStart() }),
            ctx.db.attendance.findMany({
              where: { studentId: s.id, status: { in: ["ABSENT", "LATE", "EXCUSED"] }, date: { gte: from } },
              include: { subject: true },
              orderBy: { date: "desc" },
              take: 30,
            }),
            listIncidents(ctx, { studentId: s.id }),
          ]);
          return (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle>
                  {s.firstName} {s.lastName}
                </CardTitle>
                <p className="text-muted-foreground text-sm">
                  {t("last90", { rate: stats.rate ?? 100, absent: stats.absent + stats.excused, late: stats.late })}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {absences.length === 0 && <p className="text-success text-sm">{t("perfect")}</p>}
                {absences.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3 text-sm" data-testid="family-absence">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium first-letter:uppercase">{fmt.format(a.date)}</span>
                      {a.subject && <span className="text-muted-foreground">{a.subject.name}</span>}
                      <Badge
                        variant={a.status === "LATE" ? "warning" : a.justified ? "success" : "destructive"}
                        className="ml-auto"
                      >
                        {a.justified ? t("justified") : t(`status.${a.status}`)}
                      </Badge>
                    </div>
                    {a.reason && <p className="text-muted-foreground mt-1">« {a.reason} »</p>}
                    {canJustify && a.status === "ABSENT" && !a.justified && !a.justificationSubmittedAt && (
                      <details className="mt-2">
                        <summary className="text-primary cursor-pointer font-medium">{t("justify")}</summary>
                        <ActionForm
                          action={submitJustificationAction}
                          school={school}
                          successMessage={t("justificationSent")}
                          className="mt-2"
                        >
                          <input type="hidden" name="attendanceId" value={a.id} />
                          <Field name="reason" label={t("reason")}>
                            <Input id={`reason-${a.id}`} name="reason" required />
                          </Field>
                          <Field name="file" label={t("proof")}>
                            <Input
                              id={`proof-${a.id}`}
                              name="file"
                              type="file"
                              accept="application/pdf,image/jpeg,image/png,image/webp"
                              capture="environment"
                              className="pt-3"
                            />
                          </Field>
                          <SubmitButton size="sm" className="self-start">
                            {t("sendJustification")}
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                    {a.justificationSubmittedAt && !a.justified && (
                      <p className="text-muted-foreground mt-1 text-xs">{t("justificationPending")}</p>
                    )}
                  </div>
                ))}
                {incidents.items.length > 0 && (
                  <div className="border-t pt-3">
                    <p className="mb-2 font-medium">{td("title")}</p>
                    {incidents.items.map((i) => (
                      <p key={i.id} className="text-sm">
                        <Badge variant="outline">{td(`types.${i.type}`)}</Badge> {fmt.format(i.date)} — {i.description}
                        {i.sanction && <span className="text-muted-foreground block">{i.sanction}</span>}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        }),
      )}
    </>
  );
}
