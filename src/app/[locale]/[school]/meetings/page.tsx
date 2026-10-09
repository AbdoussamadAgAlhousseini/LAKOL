import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarClock, MapPin, X } from "lucide-react";
import { loadSchoolPage } from "@/server/page-context";
import { availableSlots, listMySlots, myBookings } from "@/server/services/meetings";
import { addDays, isoDate } from "@/lib/time";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { bookSlotAction, cancelBookingAction, cancelSlotAction, createSlotsAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("meetings"))("title") };
}

export default async function MeetingsPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadSchoolPage(school, locale);
  const teacher = Boolean(ctx?.staffId && ctx.scope.permissions.has("meeting.manage:own"));
  const family = Boolean(ctx?.scope.permissions.has("meeting.book:own"));
  if (!ctx || (!teacher && !family)) return <Forbidden />;
  const t = await getTranslations("meetings");
  const tz = ctx.school.timezone;
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const dayKey = (d: Date) => isoDate(d);

  if (teacher) {
    const slots = await listMySlots(ctx);
    const days = [...new Set(slots.map((s) => dayKey(s.startsAt)))];
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("teacherHint")} />
        <Card>
          <CardHeader>
            <CardTitle>{t("newSlots")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createSlotsAction}
              school={school}
              successMessage={t("slotsCreated")}
              className="grid gap-4 sm:grid-cols-5"
            >
              <Field name="date" label={t("date")}>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  min={isoDate(new Date())}
                  defaultValue={isoDate(addDays(new Date(), 1))}
                />
              </Field>
              <Field name="start" label={t("start")}>
                <Input id="start" name="start" type="time" defaultValue="16:00" />
              </Field>
              <Field name="count" label={t("count")}>
                <Input id="count" name="count" type="number" min={1} max={20} defaultValue={6} />
              </Field>
              <Field name="durationMin" label={t("duration")}>
                <Select id="durationMin" name="durationMin" defaultValue="15">
                  {[10, 15, 20, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {t("minutes", { count: m })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="location" label={t("location")}>
                <Input id="location" name="location" maxLength={120} placeholder={t("locationPlaceholder")} />
              </Field>
              <SubmitButton className="self-start">{t("publishSlots")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
        {days.length === 0 && <p className="text-muted-foreground text-sm">{t("noSlot")}</p>}
        {days.map((d) => (
          <Card key={d} className="p-0" data-testid="slot-day">
            <CardHeader className="pb-2">
              <CardTitle className="text-base capitalize">{day.format(new Date(`${d}T12:00:00Z`))}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {slots
                .filter((s) => dayKey(s.startsAt) === d)
                .map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid="slot">
                    <span className="font-semibold tabular-nums">
                      {time.format(s.startsAt)} – {time.format(s.endsAt)}
                    </span>
                    {s.status === "BOOKED" ? (
                      <>
                        <Badge variant="success">{t("booked")}</Badge>
                        <span className="min-w-0 flex-1">
                          {s.guardian && `${s.guardian.firstName} ${s.guardian.lastName}`}
                          {s.student && ` · ${t("parentOf", { name: s.student.firstName })}`}
                          {s.guardian?.phone && <span className="text-muted-foreground"> · {s.guardian.phone}</span>}
                          {s.note && <span className="text-muted-foreground block text-xs">« {s.note} »</span>}
                        </span>
                      </>
                    ) : (
                      <>
                        <Badge variant="secondary">{t("open")}</Badge>
                        <span className="flex-1" />
                      </>
                    )}
                    {s.location && (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <MapPin className="size-3" aria-hidden /> {s.location}
                      </span>
                    )}
                    <ActionButton
                      action={cancelSlotAction}
                      school={school}
                      fields={{ id: s.id }}
                      variant="ghost"
                      confirm={s.status === "BOOKED" ? t("confirmCancelBooked") : undefined}
                    >
                      <X aria-hidden /> <span className="sr-only sm:not-sr-only">{t("remove")}</span>
                    </ActionButton>
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const [bookings, teachers] = await Promise.all([myBookings(ctx), availableSlots(ctx)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("parentHint")} />
      {bookings.length > 0 && (
        <Card data-testid="my-bookings">
          <CardHeader>
            <CardTitle>{t("myBookings")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {bookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <CalendarClock className="text-primary size-6 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold capitalize">
                    {day.format(b.startsAt)} · {time.format(b.startsAt)}
                  </p>
                  <p className="text-muted-foreground">
                    {b.staff.firstName} {b.staff.lastName}
                    {b.student && ` · ${b.student.firstName}`}
                    {b.location && ` · ${b.location}`}
                  </p>
                </div>
                <ActionButton
                  action={cancelBookingAction}
                  school={school}
                  fields={{ id: b.id }}
                  confirm={t("confirmCancelBooking")}
                >
                  {t("cancelBooking")}
                </ActionButton>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {teachers.length === 0 && <p className="text-muted-foreground text-sm">{t("noTeacher")}</p>}
      {teachers.map((teacherInfo) => (
        <Card key={teacherInfo.staffId} data-testid="teacher-slots">
          <CardHeader>
            <CardTitle>{teacherInfo.name}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {teacherInfo.subjects.join(", ")} · {teacherInfo.students.map((s) => s.name).join(", ")}
            </p>
          </CardHeader>
          <CardContent>
            {teacherInfo.slots.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noFreeSlot")}</p>
            ) : (
              <ActionForm action={bookSlotAction} school={school} successMessage={t("bookedOk")}>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">{t("chooseSlot")}</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {teacherInfo.slots.map((s, i) => (
                      <label
                        key={s.id}
                        className="has-[:checked]:border-primary has-[:checked]:bg-primary/10 flex min-h-12 cursor-pointer flex-col justify-center rounded-md border px-3 py-1 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="slotId"
                            value={s.id}
                            defaultChecked={i === 0}
                            className="accent-primary size-4"
                          />
                          <span className="font-semibold tabular-nums">{time.format(s.startsAt)}</span>
                        </span>
                        <span className="text-muted-foreground text-xs capitalize">{day.format(s.startsAt)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {teacherInfo.students.length > 1 ? (
                  <Field name="studentId" label={t("forChild")}>
                    <Select id={`student-${teacherInfo.staffId}`} name="studentId">
                      {teacherInfo.students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <input type="hidden" name="studentId" value={teacherInfo.students[0]?.id} />
                )}
                <Field name="note" label={t("note")}>
                  <Input
                    id={`note-${teacherInfo.staffId}`}
                    name="note"
                    maxLength={300}
                    placeholder={t("notePlaceholder")}
                  />
                </Field>
                <SubmitButton className="self-start">{t("book")}</SubmitButton>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
