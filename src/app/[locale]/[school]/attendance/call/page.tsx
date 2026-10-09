import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadSchoolPage, loadOrDeny } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { getRollCall } from "@/server/services/attendance";
import { dayStart, formatTime, isoDate, parseIsoDate } from "@/lib/time";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { RollCall } from "./roll-call";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("attendance"))("callTitle") };
}

export default async function CallPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ classId?: string; slotId?: string; date?: string }>;
}) {
  const { locale, school } = await params;
  const sp = await searchParams;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx || !can(ctx.scope, "attendance.write") || !sp.classId) return <Forbidden />;
  const date = parseIsoDate(sp.date) ?? dayStart();
  const sheet = await loadOrDeny(getRollCall(ctx, { classId: sp.classId, date, slotId: sp.slotId }));
  if (!sheet) return <Forbidden />;
  const t = await getTranslations("attendance");
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={`${t("callTitle")} — ${sheet.class.name}`}
        description={[
          fmt.format(date),
          sheet.slot &&
            `${sheet.slot.subject.name} ${formatTime(sheet.slot.startMin)}–${formatTime(sheet.slot.endMin)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      {sheet.alreadyTaken && <Alert className="mb-4">{t("alreadyTaken")}</Alert>}
      <RollCall
        school={school}
        classId={sheet.class.id}
        date={isoDate(date)}
        slotId={sheet.slot?.id}
        students={sheet.students}
      />
    </div>
  );
}
