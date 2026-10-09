import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import type { SchoolContext } from "@/server/context";
import { getActiveYear } from "@/server/services/structure";
import { staffOptions } from "@/server/services/options";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  activateYearAction,
  archiveYearAction,
  createCycleAction,
  createTrackAction,
  createYearAction,
  deleteClassAction,
  deleteLevelAction,
  deleteRoomAction,
  deleteSubjectAction,
  saveClassAction,
  saveLevelAction,
  saveRoomAction,
  saveSubjectAction,
  setCoefficientsAction,
  updateTermAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("structure"))("title") };
}

const TABS = ["years", "levels", "classes", "subjects", "rooms"] as const;
type Tab = (typeof TABS)[number];
type Props = { ctx: SchoolContext; school: string; locale: string; level?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function StructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ tab?: string; level?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "school.structure.manage"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const tab: Tab = TABS.find((x) => x === sp.tab) ?? "classes";
  const t = await getTranslations("structure");
  const props = { ctx, school, locale, level: sp.level };

  return (
    <>
      <PageHeader title={t("title")} />
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label={t("title")}>
        {TABS.map((x) => (
          <Link
            key={x}
            href={`/${school}/structure?tab=${x}`}
            aria-current={x === tab ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm",
              x === tab && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {t(`tabs.${x}`)}
          </Link>
        ))}
      </nav>
      {tab === "years" && <YearsTab {...props} />}
      {tab === "levels" && <LevelsTab {...props} />}
      {tab === "classes" && <ClassesTab {...props} />}
      {tab === "subjects" && <SubjectsTab {...props} />}
      {tab === "rooms" && <RoomsTab {...props} />}
    </>
  );
}

// ── Années et périodes ─────────────────────────────────────────────────────

async function YearsTab({ ctx, school, locale }: Props) {
  const t = await getTranslations("structure");
  const years = await ctx.db.academicYear.findMany({
    include: { terms: { orderBy: { order: "asc" } } },
    orderBy: { startDate: "desc" },
  });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const next = new Date().getUTCFullYear();

  return (
    <div className="flex flex-col gap-6">
      {years.map((y) => (
        <Card key={y.id}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              {y.name}
              {y.isActive && <Badge variant="success">{t("active")}</Badge>}
              {y.isArchived && <Badge variant="secondary">{t("archived")}</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              {!y.isActive && !y.isArchived && (
                <>
                  <ActionButton
                    action={activateYearAction}
                    school={school}
                    fields={{ id: y.id }}
                    confirm={t("activateConfirm")}
                  >
                    {t("activate")}
                  </ActionButton>
                  <ActionButton action={archiveYearAction} school={school} fields={{ id: y.id }} variant="ghost">
                    {t("archive")}
                  </ActionButton>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              {dateFmt.format(y.startDate)} → {dateFmt.format(y.endDate)}
            </p>
            {y.terms.map((term) => (
              <details key={term.id} className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{term.name}</span> · {dateFmt.format(term.startDate)} →{" "}
                  {dateFmt.format(term.endDate)}
                  {term.isLocked && (
                    <Badge variant="secondary" className="ml-2">
                      {t("locked")}
                    </Badge>
                  )}
                </summary>
                <ActionForm action={updateTermAction} school={school} className="mt-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="id" value={term.id} />
                  <Field name="name" label={t("termName")}>
                    <Input id={`tn-${term.id}`} name="name" defaultValue={term.name} />
                  </Field>
                  <Field name="startDate" label={t("start")}>
                    <Input id={`ts-${term.id}`} name="startDate" type="date" defaultValue={iso(term.startDate)} />
                  </Field>
                  <Field name="endDate" label={t("end")}>
                    <Input id={`te-${term.id}`} name="endDate" type="date" defaultValue={iso(term.endDate)} />
                  </Field>
                  <SubmitButton size="sm" className="self-end">
                    {t("save")}
                  </SubmitButton>
                </ActionForm>
              </details>
            ))}
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>{t("newYear")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("newYearHint")}</p>
        </CardHeader>
        <CardContent>
          <ActionForm action={createYearAction} school={school} resetOnSuccess className="grid gap-4 sm:grid-cols-4">
            <Field name="name" label={t("yearName")}>
              <Input id="year-name" name="name" placeholder={`${next}-${next + 1}`} required />
            </Field>
            <Field name="startDate" label={t("start")}>
              <Input id="year-start" name="startDate" type="date" required />
            </Field>
            <Field name="endDate" label={t("end")}>
              <Input id="year-end" name="endDate" type="date" required />
            </Field>
            <SubmitButton className="self-end">{t("create")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Cycles, niveaux, séries, coefficients ─────────────────────────────────

async function LevelsTab({ ctx, school, level }: Props) {
  const t = await getTranslations("structure");
  const [cycles, tracks, subjects] = await Promise.all([
    ctx.db.cycle.findMany({
      include: { levels: { orderBy: { order: "asc" }, include: { _count: { select: { classes: true } } } } },
      orderBy: { order: "asc" },
    }),
    ctx.db.track.findMany({ orderBy: { code: "asc" } }),
    ctx.db.subject.findMany({ orderBy: { name: "asc" } }),
  ]);
  const selected = cycles.flatMap((c) => c.levels).find((l) => l.id === level);
  const coefficients = selected ? await ctx.db.subjectCoefficient.findMany({ where: { levelId: selected.id } }) : [];
  const byTrack = new Map<string | null, typeof coefficients>();
  coefficients.forEach((c) => byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c]));
  const grids = selected ? [null, ...[...byTrack.keys()].filter((k): k is string => k !== null)] : [];

  return (
    <div className="flex flex-col gap-6">
      {cycles.map((cycle) => (
        <Card key={cycle.id}>
          <CardHeader>
            <CardTitle>{cycle.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {cycle.levels.map((l) => (
              <details key={l.id} className="rounded-md border px-3 py-2" open={l.id === level}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{l.name}</span>
                  {l.nationalExam && <Badge variant="outline">{l.nationalExam}</Badge>}
                  {!l.studentAccounts && <Badge variant="secondary">{t("noStudentAccounts")}</Badge>}
                  <Link
                    href={`/${school}/structure?tab=levels&level=${l.id}`}
                    className="text-primary ml-auto underline-offset-4 hover:underline"
                  >
                    {t("coefficients")}
                  </Link>
                </summary>
                <ActionForm action={saveLevelAction} school={school} className="mt-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="cycleId" value={cycle.id} />
                  <LevelFields t={t} defaults={l} />
                  <div className="flex gap-2 sm:col-span-4">
                    <SubmitButton size="sm">{t("save")}</SubmitButton>
                  </div>
                </ActionForm>
                {l._count.classes === 0 && (
                  <div className="mt-2">
                    <ActionButton
                      action={deleteLevelAction}
                      school={school}
                      fields={{ id: l.id }}
                      variant="ghost"
                      confirm={t("deleteConfirm")}
                    >
                      {t("delete")}
                    </ActionButton>
                  </div>
                )}
              </details>
            ))}
            <details className="rounded-md border border-dashed px-3 py-2">
              <summary className="text-primary cursor-pointer text-sm font-medium">{t("newLevel")}</summary>
              <ActionForm
                action={saveLevelAction}
                school={school}
                resetOnSuccess
                className="mt-3 grid gap-3 sm:grid-cols-4"
              >
                <input type="hidden" name="cycleId" value={cycle.id} />
                <LevelFields t={t} defaults={{ order: (cycle.levels.at(-1)?.order ?? 0) + 1, studentAccounts: true }} />
                <SubmitButton size="sm" className="self-start sm:col-span-4">
                  {t("create")}
                </SubmitButton>
              </ActionForm>
            </details>
          </CardContent>
        </Card>
      ))}

      {selected && (
        <Card id="coefficients">
          <CardHeader>
            <CardTitle>
              {t("coefficients")} — {selected.name}
            </CardTitle>
            <p className="text-muted-foreground text-sm">{t("coefficientsHint")}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {grids.map((trackId) => {
              const current = new Map((byTrack.get(trackId) ?? []).map((c) => [c.subjectId, c]));
              return (
                <ActionForm
                  key={trackId ?? "all"}
                  action={setCoefficientsAction}
                  school={school}
                  successMessage={t("saved")}
                >
                  <input type="hidden" name="levelId" value={selected.id} />
                  {trackId && <input type="hidden" name="trackId" value={trackId} />}
                  {trackId && <p className="font-medium">{tracks.find((tr) => tr.id === trackId)?.name}</p>}
                  <Table>
                    <thead>
                      <tr>
                        <Th>{t("subject")}</Th>
                        <Th>{t("coefficient")}</Th>
                        <Th>{t("weeklyHours")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {subjects.map((s) => (
                        <tr key={s.id}>
                          <Td>{s.name}</Td>
                          <Td>
                            <Input
                              name={`coef_${s.id}`}
                              aria-label={`${t("coefficient")} ${s.name}`}
                              type="number"
                              min={0}
                              max={20}
                              inputMode="numeric"
                              defaultValue={current.get(s.id)?.coefficient ?? ""}
                              className="h-10 w-20"
                            />
                          </Td>
                          <Td>
                            <Input
                              name={`hours_${s.id}`}
                              aria-label={`${t("weeklyHours")} ${s.name}`}
                              type="number"
                              min={0}
                              max={40}
                              inputMode="numeric"
                              defaultValue={
                                current.get(s.id)?.weeklyMinutes ? current.get(s.id)!.weeklyMinutes! / 60 : ""
                              }
                              className="h-10 w-20"
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <SubmitButton size="sm" className="self-start">
                    {t("save")}
                  </SubmitButton>
                </ActionForm>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("newCycle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createCycleAction}
              school={school}
              resetOnSuccess
              className="grid gap-3 sm:grid-cols-[1fr_6rem_auto]"
            >
              <Field name="name" label={t("cycle")}>
                <Input id="cycle-name" name="name" required />
              </Field>
              <Field name="order" label={t("order")}>
                <Input id="cycle-order" name="order" type="number" min={0} defaultValue={cycles.length + 1} />
              </Field>
              <SubmitButton className="self-end">{t("create")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("tracks")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {tracks.map((tr) => (
                <Badge key={tr.id} variant="outline">
                  {tr.code} — {tr.name}
                </Badge>
              ))}
            </div>
            <ActionForm
              action={createTrackAction}
              school={school}
              resetOnSuccess
              className="grid gap-3 sm:grid-cols-[6rem_1fr_auto]"
            >
              <Field name="code" label={t("code")}>
                <Input id="track-code" name="code" required />
              </Field>
              <Field name="name" label={t("trackName")}>
                <Input id="track-name" name="name" required />
              </Field>
              <SubmitButton className="self-end">{t("create")}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LevelFields({
  t,
  defaults,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"structure">>>;
  defaults: { name?: string; order?: number; nationalExam?: string | null; studentAccounts?: boolean; id?: string };
}) {
  const key = defaults.id ?? "new";
  return (
    <>
      <Field name="name" label={t("levelName")}>
        <Input id={`ln-${key}`} name="name" defaultValue={defaults.name} required />
      </Field>
      <Field name="order" label={t("order")}>
        <Input id={`lo-${key}`} name="order" type="number" min={0} defaultValue={defaults.order} />
      </Field>
      <Field name="nationalExam" label={t("nationalExam")}>
        <Select id={`le-${key}`} name="nationalExam" defaultValue={defaults.nationalExam ?? ""}>
          <option value="">—</option>
          <option value="DEF">DEF</option>
          <option value="BAC">BAC</option>
        </Select>
      </Field>
      <label className="flex items-center gap-3 self-end pb-3 text-sm">
        <input
          type="checkbox"
          name="studentAccounts"
          defaultChecked={defaults.studentAccounts}
          className="accent-primary size-5"
        />
        {t("studentAccounts")}
      </label>
    </>
  );
}

// ── Classes ────────────────────────────────────────────────────────────────

async function ClassesTab({ ctx, school }: Props) {
  const t = await getTranslations("structure");
  const year = await getActiveYear(ctx);
  if (!year) return <Alert>{t("noYear")}</Alert>;
  const [classes, levels, tracks, rooms, staff] = await Promise.all([
    ctx.db.class.findMany({
      where: { academicYearId: year.id },
      include: {
        level: true,
        track: true,
        room: true,
        headTeacher: true,
        _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
      },
      orderBy: [{ level: { order: "asc" } }, { name: "asc" }],
    }),
    ctx.db.level.findMany({ orderBy: { order: "asc" } }),
    ctx.db.track.findMany({ orderBy: { code: "asc" } }),
    ctx.db.room.findMany({ orderBy: { name: "asc" } }),
    staffOptions(ctx),
  ]);

  const fields = (d: Partial<(typeof classes)[number]> = {}) => {
    const key = d.id ?? "new";
    return (
      <>
        <Field name="name" label={t("className")}>
          <Input id={`cn-${key}`} name="name" defaultValue={d.name} required />
        </Field>
        <Field name="levelId" label={t("level")}>
          <Select id={`cl-${key}`} name="levelId" defaultValue={d.levelId ?? ""} required>
            <option value="" disabled>
              —
            </option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="trackId" label={t("track")}>
          <Select id={`ct-${key}`} name="trackId" defaultValue={d.trackId ?? ""}>
            <option value="">—</option>
            {tracks.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="headTeacherId" label={t("headTeacher")}>
          <Select id={`ch-${key}`} name="headTeacherId" defaultValue={d.headTeacherId ?? ""}>
            <option value="">—</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="roomId" label={t("room")}>
          <Select id={`cr-${key}`} name="roomId" defaultValue={d.roomId ?? ""}>
            <option value="">—</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="capacity" label={t("capacity")}>
          <Input id={`cc-${key}`} name="capacity" type="number" min={1} defaultValue={d.capacity ?? ""} />
        </Field>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t("classesOfYear", { year: year.name })}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {classes.map((c) => (
          <Card key={c.id} data-testid="structure-class">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <Link href={`/${school}/classes/${c.id}`} className="underline-offset-4 hover:underline">
                  {c.name}
                </Link>
                <span className="text-muted-foreground text-sm font-normal">
                  {t("studentsCount", { count: c._count.enrollments })}
                  {c.capacity ? ` / ${c.capacity}` : ""}
                </span>
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                {c.level.name}
                {c.track && ` · ${c.track.code}`}
                {c.room && ` · ${c.room.name}`}
                {c.headTeacher && ` · ${t("headTeacher")} : ${c.headTeacher.firstName} ${c.headTeacher.lastName}`}
              </p>
            </CardHeader>
            <CardContent>
              <details>
                <summary className="text-primary cursor-pointer text-sm font-medium">{t("edit")}</summary>
                <ActionForm action={saveClassAction} school={school} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} />
                  {fields(c)}
                  <SubmitButton size="sm" className="self-start">
                    {t("save")}
                  </SubmitButton>
                </ActionForm>
                {c._count.enrollments === 0 && (
                  <div className="mt-2">
                    <ActionButton
                      action={deleteClassAction}
                      school={school}
                      fields={{ id: c.id }}
                      variant="ghost"
                      confirm={t("deleteConfirm")}
                    >
                      {t("delete")}
                    </ActionButton>
                  </div>
                )}
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("newClass")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveClassAction} school={school} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
            {fields()}
            <SubmitButton className="self-start">{t("create")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Matières et salles ─────────────────────────────────────────────────────

async function SubjectsTab({ ctx, school }: Props) {
  const t = await getTranslations("structure");
  const subjects = await ctx.db.subject.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="flex flex-col gap-6">
      <Card className="divide-y p-0">
        {subjects.map((s) => (
          <details key={s.id} className="p-4">
            <summary className="flex cursor-pointer items-center gap-3">
              <span
                className="size-4 rounded-full"
                style={{ backgroundColor: s.color ?? "var(--muted)" }}
                aria-hidden
              />
              <span className="font-medium">{s.name}</span>
              <Badge variant="outline">{s.code}</Badge>
            </summary>
            <ActionForm action={saveSubjectAction} school={school} className="mt-3 grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="id" value={s.id} />
              <SubjectFields t={t} defaults={s} />
              <SubmitButton size="sm" className="self-end">
                {t("save")}
              </SubmitButton>
            </ActionForm>
            <div className="mt-2">
              <ActionButton
                action={deleteSubjectAction}
                school={school}
                fields={{ id: s.id }}
                variant="ghost"
                confirm={t("deleteConfirm")}
              >
                {t("delete")}
              </ActionButton>
            </div>
          </details>
        ))}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("newSubject")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveSubjectAction} school={school} resetOnSuccess className="grid gap-3 sm:grid-cols-4">
            <SubjectFields t={t} defaults={{ color: "#2563EB" }} />
            <SubmitButton className="self-end">{t("create")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

function SubjectFields({
  t,
  defaults,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"structure">>>;
  defaults: { id?: string; code?: string; name?: string; color?: string | null };
}) {
  const key = defaults.id ?? "new";
  return (
    <>
      <Field name="code" label={t("code")}>
        <Input id={`sc-${key}`} name="code" defaultValue={defaults.code} required />
      </Field>
      <Field name="name" label={t("subjectName")}>
        <Input id={`sn-${key}`} name="name" defaultValue={defaults.name} required />
      </Field>
      <Field name="color" label={t("color")}>
        <Input id={`sk-${key}`} name="color" type="color" defaultValue={defaults.color ?? "#2563EB"} className="p-1" />
      </Field>
    </>
  );
}

async function RoomsTab({ ctx, school }: Props) {
  const t = await getTranslations("structure");
  const rooms = await ctx.db.room.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="flex flex-col gap-6">
      <Card className="divide-y p-0">
        {rooms.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-4">
            <span className="flex-1 font-medium">{r.name}</span>
            {r.capacity && (
              <span className="text-muted-foreground text-sm">{t("capacityValue", { count: r.capacity })}</span>
            )}
            <ActionButton
              action={deleteRoomAction}
              school={school}
              fields={{ id: r.id }}
              variant="ghost"
              size="icon"
              confirm={t("deleteConfirm")}
            >
              <Trash2 aria-label={t("delete")} />
            </ActionButton>
          </div>
        ))}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("newRoom")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={saveRoomAction}
            school={school}
            resetOnSuccess
            className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]"
          >
            <Field name="name" label={t("roomName")}>
              <Input id="room-name" name="name" required />
            </Field>
            <Field name="capacity" label={t("capacity")}>
              <Input id="room-capacity" name="capacity" type="number" min={1} />
            </Field>
            <SubmitButton className="self-end">{t("create")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
