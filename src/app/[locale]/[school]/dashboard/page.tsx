import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import {
  BookOpen,
  CalendarX,
  ClipboardCheck,
  GraduationCap,
  NotebookPen,
  Rocket,
  Shapes,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { myTodaySlots } from "@/server/services/attendance";
import { dayStart, formatTime, isoDate } from "@/lib/time";
import { loadSchoolPage } from "@/server/page-context";
import { getSchoolOverview, getStudentCards, getTeacherClasses } from "@/server/services/dashboard";
import type { SchoolContext } from "@/server/context";
import { can, canAll } from "@/server/rbac/policies";
import { onboardingState } from "@/server/services/onboarding";
import { formatMoney } from "@/lib/money";
import { formatScore } from "@/lib/grades";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return null; // le layout affiche déjà « Accès refusé »
  const t = await getTranslations("dashboard");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("hello", { name: ctx.user.firstName })}</h1>
      <OnboardingPrompt ctx={ctx} />
      {ctx.activeRole === "PARENT" || ctx.activeRole === "STUDENT" ? (
        <StudentCards ctx={ctx} locale={locale} />
      ) : ctx.activeRole === "TEACHER" || ctx.activeRole === "HEAD_TEACHER" ? (
        <TeacherClasses ctx={ctx} />
      ) : (
        <SchoolOverview ctx={ctx} locale={locale} />
      )}
    </div>
  );
}

/** Rappel de l'assistant de démarrage pour la direction d'une nouvelle école. */
async function OnboardingPrompt({ ctx }: { ctx: SchoolContext }) {
  if (ctx.school.onboardingDoneAt || !canAll(ctx.scope, "school.settings.manage")) return null;
  const state = await onboardingState(ctx);
  if (state.finished) return null;
  const t = await getTranslations("onboarding");
  return (
    <Link
      href={`/${ctx.school.slug}/onboarding`}
      className="border-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-4 rounded-lg border p-4"
      data-testid="onboarding-prompt"
    >
      <Rocket className="text-primary size-8 shrink-0" aria-hidden />
      <span className="flex-1">
        <span className="block font-semibold">{t("promptTitle")}</span>
        <span className="text-muted-foreground text-sm">
          {t("progress", { done: state.completed, total: state.total })}
        </span>
      </span>
    </Link>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">{icon}</div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-muted-foreground text-sm">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

async function SchoolOverview({ ctx, locale }: { ctx: SchoolContext; locale: string }) {
  const t = await getTranslations("dashboard");
  const data = await getSchoolOverview(ctx);
  if (!data) return <p className="text-muted-foreground">{t("noData")}</p>;
  const currency = ctx.school.currency;
  const showStudents = can(ctx.scope, "student.read");

  return (
    <>
      <p className="text-muted-foreground -mt-4">{t("year", { year: data.year })}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {showStudents && <Stat icon={<GraduationCap />} label={t("students")} value={data.students} />}
        {can(ctx.scope, "staff.read") && <Stat icon={<Users />} label={t("staff")} value={data.staff} />}
        {showStudents && <Stat icon={<Shapes />} label={t("classes")} value={data.classes} />}
        {can(ctx.scope, "attendance.read") && (
          <Stat icon={<CalendarX />} label={t("absencesToday")} value={data.absencesToday} />
        )}
      </div>
      {data.finance && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat icon={<Wallet />} label={t("expected")} value={formatMoney(data.finance.expected, currency, locale)} />
          <Stat
            icon={<Wallet />}
            label={t("collected")}
            value={formatMoney(data.finance.collected, currency, locale)}
          />
          <Stat
            icon={<Wallet />}
            label={t("recovery")}
            value={`${data.finance.expected ? Math.round((data.finance.collected / data.finance.expected) * 100) : 0} %`}
          />
        </div>
      )}
    </>
  );
}

async function TeacherClasses({ ctx }: { ctx: SchoolContext }) {
  const t = await getTranslations("dashboard");
  const [classes, slots] = await Promise.all([getTeacherClasses(ctx), myTodaySlots(ctx)]);
  const today = isoDate(dayStart());
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("today")}</h2>
      {slots.length === 0 && <p className="text-muted-foreground">{t("noCourseToday")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((s) => (
          <Link
            key={s.id}
            href={`/${ctx.school.slug}/attendance/call?classId=${s.classId}&slotId=${s.id}&date=${today}`}
            className="bg-card hover:bg-accent flex min-h-14 items-center gap-3 rounded-lg border p-3"
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
            <span className="text-primary text-sm font-medium">{t("takeCall")}</span>
          </Link>
        ))}
      </div>
      <h2 className="mt-4 text-lg font-semibold">{t("myClasses")}</h2>
      {classes.length === 0 && <p className="text-muted-foreground">{t("noClass")}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => (
          <Card key={c.id} data-testid="teacher-class">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                {c.name}
                {c.isHead && <Badge variant="secondary">{t("headTeacher")}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground flex flex-col gap-1 text-sm">
              <span>{t("studentsCount", { count: c.students })}</span>
              <span>{c.subjects.join(", ")}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

async function StudentCards({ ctx, locale }: { ctx: SchoolContext; locale: string }) {
  const t = await getTranslations("dashboard");
  const cards = await getStudentCards(ctx);
  const isParent = ctx.activeRole === "PARENT";
  if (cards.length === 0) return <p className="text-muted-foreground">{t("noChild")}</p>;

  return (
    <section className="flex flex-col gap-3">
      {isParent && <h2 className="text-lg font-semibold">{t("myChildren")}</h2>}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((s) => (
          <Card key={s.id} data-testid="child-card">
            <CardHeader>
              <CardTitle>{s.name}</CardTitle>
              {s.className && <p className="text-muted-foreground text-sm">{s.className}</p>}
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-3 text-sm">
                <Tile icon={<BookOpen className="size-5" />} label={t("latestGrade")}>
                  {s.latestGrade ? (
                    <>
                      {formatScore(s.latestGrade.score, locale)}/{s.latestGrade.outOf}
                      <span className="text-muted-foreground block text-xs font-normal">{s.latestGrade.subject}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </Tile>
                <Tile
                  icon={<NotebookPen className="size-5" />}
                  label={t("homeworkDue")}
                  tone={s.homeworkDue ? "warning" : "ok"}
                >
                  {s.homeworkDue}
                </Tile>
                <Tile icon={<CalendarX className="size-5" />} label={t("absences")} tone={s.absences ? "danger" : "ok"}>
                  {s.absences}
                </Tile>
                {s.balance !== null && (
                  <Tile
                    icon={<Wallet className="size-5" />}
                    label={t("balance")}
                    tone={s.balance > 0 ? "danger" : "ok"}
                  >
                    {s.balance > 0 ? formatMoney(s.balance, ctx.school.currency, locale) : t("paidUp")}
                  </Tile>
                )}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// Tuile à code couleur : lisible même avec peu de texte.
function Tile({
  icon,
  label,
  tone = "neutral",
  children,
}: {
  icon: ReactNode;
  label: string;
  tone?: "neutral" | "ok" | "warning" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted",
    ok: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <li className={`flex flex-col gap-1 rounded-lg p-3 ${tones[tone]}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </span>
      <span className="text-lg font-bold">{children}</span>
    </li>
  );
}
