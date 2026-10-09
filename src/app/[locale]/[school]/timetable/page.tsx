import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { classOptions, staffOptions } from "@/server/services/options";
import { getWeek } from "@/server/services/timetable";
import { getActiveYear } from "@/server/services/structure";
import { addDays, formatTime, isoDate, parseIsoDate, weekStart } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addSlotAction, deleteSlotAction, removeExceptionAction, setExceptionAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("timetable"))("title") };
}

export default async function TimetablePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ classId?: string; week?: string; mine?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "timetable.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [t, year] = await Promise.all([getTranslations("timetable"), getActiveYear(ctx)]);
  if (!year) return <Alert>{t("noYear")}</Alert>;

  const canEdit = can(ctx.scope, "timetable.write");
  const isTeacher = Boolean(ctx.staffId) && ctx.scope.classIds.size > 0;

  // Classes proposées : toutes (personnel), celles du professeur, ou celle de chaque enfant.
  let classes = await classOptions(ctx);
  let familyLabels = new Map<string, string>();
  if (!canEdit && !can(ctx.scope, "student.read") && ctx.scope.studentIds.size > 0) {
    const enrollments = await ctx.db.enrollment.findMany({
      where: {
        studentId: { in: [...ctx.scope.studentIds] },
        academicYearId: year.id,
        status: "ACTIVE",
        deletedAt: null,
      },
      include: { student: true },
    });
    familyLabels = new Map(enrollments.map((e) => [e.classId, e.student.firstName]));
    classes = classes.filter((c) => familyLabels.has(c.id));
  } else if (isTeacher && !canEdit) {
    classes = classes.filter((c) => ctx.scope.classIds.has(c.id));
  }

  const mine = isTeacher && (sp.mine === "1" || (!sp.classId && sp.mine !== "0"));
  const classId = mine ? undefined : (classes.find((c) => c.id === sp.classId) ?? classes[0])?.id;
  const monday = weekStart(parseIsoDate(sp.week) ?? new Date());
  const { slots } = mine
    ? await getWeek(ctx, { staffId: ctx.staffId! }, monday)
    : classId
      ? await getWeek(ctx, { classId }, monday)
      : { slots: [] };
  const assignments =
    canEdit && classId
      ? await ctx.db.teachingAssignment.findMany({ where: { classId }, include: { subject: true, staff: true } })
      : [];
  const [rooms, staff] = canEdit
    ? await Promise.all([ctx.db.room.findMany({ orderBy: { name: "asc" } }), staffOptions(ctx)])
    : [[], []];

  const days = [1, 2, 3, 4, 5, 6].filter((d) => d <= 5 || slots.some((s) => s.dayOfWeek === d));
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  const query = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams(
      Object.entries({ classId, mine: mine ? "1" : undefined, week: isoDate(monday), ...extra }).filter(
        (e): e is [string, string] => Boolean(e[1]),
      ),
    );
    return `/${school}/timetable?${q}`;
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("week", { date: dayFmt.format(monday) })} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" asChild>
          <Link href={query({ week: isoDate(addDays(monday, -7)) })} aria-label={t("previousWeek")}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={query({ week: isoDate(weekStart()) })}>{t("thisWeek")}</Link>
        </Button>
        <Button variant="outline" size="icon" asChild>
          <Link href={query({ week: isoDate(addDays(monday, 7)) })} aria-label={t("nextWeek")}>
            <ChevronRight />
          </Link>
        </Button>
        <nav className="flex flex-wrap gap-2" aria-label={t("chooseClass")}>
          {isTeacher && (
            <Link
              href={`/${school}/timetable?mine=1&week=${isoDate(monday)}`}
              className={cn(
                "rounded-full border px-4 py-2 text-sm",
                mine && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {t("mine")}
            </Link>
          )}
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/${school}/timetable?classId=${c.id}&mine=0&week=${isoDate(monday)}`}
              className={cn(
                "rounded-full border px-4 py-2 text-sm",
                !mine && c.id === classId && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {familyLabels.get(c.id) ? `${familyLabels.get(c.id)} · ${c.name}` : c.name}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {days.map((day) => {
          const date = addDays(monday, day - 1);
          const daySlots = slots.filter((s) => s.dayOfWeek === day);
          return (
            <Card key={day} data-testid="timetable-day">
              <CardHeader className="pb-3">
                <CardTitle className="text-base first-letter:uppercase">{dayFmt.format(date)}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {daySlots.length === 0 && <p className="text-muted-foreground text-sm">{t("free")}</p>}
                {daySlots.map((s) => {
                  const exception = s.exceptions.find((e) => e.date.getTime() === date.getTime());
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "bg-muted/50 rounded-md border-l-4 p-2 text-sm",
                        exception?.kind === "CANCELLED" && "opacity-60",
                      )}
                      style={{ borderLeftColor: s.subject.color ?? "var(--primary)" }}
                    >
                      <p className="font-medium tabular-nums">
                        {formatTime(s.startMin)}–{formatTime(s.endMin)}
                      </p>
                      <p className={cn(exception?.kind === "CANCELLED" && "line-through")}>{s.subject.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {mine ? s.class.name : `${s.staff.firstName} ${s.staff.lastName}`}
                        {s.room && ` · ${s.room.name}`}
                      </p>
                      {exception && (
                        <Badge variant={exception.kind === "CANCELLED" ? "destructive" : "warning"} className="mt-1">
                          {exception.kind === "CANCELLED" ? t("cancelled") : t("replaced")}
                        </Badge>
                      )}
                      {canEdit && (
                        <details className="mt-2">
                          <summary className="text-primary cursor-pointer text-xs">{t("manage")}</summary>
                          <div className="mt-2 flex flex-col gap-2">
                            {exception ? (
                              <ActionButton
                                action={removeExceptionAction}
                                school={school}
                                fields={{ id: exception.id }}
                              >
                                {t("restore")}
                              </ActionButton>
                            ) : (
                              <ActionForm
                                action={setExceptionAction}
                                school={school}
                                confirm={t("notifyConfirm")}
                                className="gap-2"
                              >
                                <input type="hidden" name="slotId" value={s.id} />
                                <input type="hidden" name="date" value={isoDate(date)} />
                                <Select name="kind" aria-label={t("change")} defaultValue="CANCELLED" className="h-10">
                                  <option value="CANCELLED">{t("cancel")}</option>
                                  <option value="REPLACED">{t("replace")}</option>
                                </Select>
                                <Select
                                  name="replacementStaffId"
                                  aria-label={t("replacement")}
                                  defaultValue=""
                                  className="h-10"
                                >
                                  <option value="">{t("replacement")}</option>
                                  {staff.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </Select>
                                <Input name="note" aria-label={t("note")} placeholder={t("note")} className="h-10" />
                                <SubmitButton size="sm">{t("apply")}</SubmitButton>
                              </ActionForm>
                            )}
                            <ActionButton
                              action={deleteSlotAction}
                              school={school}
                              fields={{ id: s.id }}
                              confirm={t("deleteConfirm")}
                              variant="ghost"
                            >
                              <Trash2 /> {t("deleteSlot")}
                            </ActionButton>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {canEdit && classId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("addSlot")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("addSlotHint")}</p>
          </CardHeader>
          <CardContent>
            {assignments.length === 0 ? (
              <Alert>{t("noAssignment")}</Alert>
            ) : (
              <ActionForm action={addSlotAction} school={school} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <input type="hidden" name="classId" value={classId} />
                <Field name="subjectId" label={t("subject")} className="sm:col-span-2">
                  <Select id="subjectId" name="subjectId" defaultValue="">
                    <option value="" disabled>
                      —
                    </option>
                    {assignments.map((a) => (
                      <option key={a.id} value={a.subjectId}>
                        {a.subject.name} ({a.staff.firstName} {a.staff.lastName})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="dayOfWeek" label={t("day")}>
                  <Select id="dayOfWeek" name="dayOfWeek" defaultValue="1">
                    {[1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={d} value={d}>
                        {t(`days.${d}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="start" label={t("start")}>
                  <Input id="start" name="start" type="time" defaultValue="08:00" step={300} />
                </Field>
                <Field name="end" label={t("end")}>
                  <Input id="end" name="end" type="time" defaultValue="09:00" step={300} />
                </Field>
                <Field name="roomId" label={t("room")}>
                  <Select id="roomId" name="roomId" defaultValue="">
                    <option value="">—</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton className="self-end">{t("add")}</SubmitButton>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
