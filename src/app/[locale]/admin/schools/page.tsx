import { getTranslations } from "next-intl/server";
import { Plus, Search } from "lucide-react";
import type { SubscriptionStatus } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { listPlatformSchools } from "@/server/platform/admin";
import { cn } from "@/lib/utils";
import { STATUS_VARIANT } from "@/components/admin/status";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const;

export default async function AdminSchools({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) as SubscriptionStatus | undefined;
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const [t, schools] = await Promise.all([getTranslations("admin"), listPlatformSchools({ q, status })]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.schools")}
        actions={
          <Button asChild>
            <Link href="/admin/schools/new">
              <Plus aria-hidden /> {t("newSchool")}
            </Link>
          </Button>
        }
      />
      <form className="flex gap-2" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder={t("search")} className="h-11" />
        <Button type="submit" variant="outline" size="icon" className="size-11" aria-label={t("search")}>
          <Search />
        </Button>
      </form>
      <nav className="flex flex-wrap gap-2">
        {[undefined, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={`/admin/schools${s ? `?status=${s}` : ""}`}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm",
              s === status && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {s ? t(`statuses.${s}`) : t("all")}
          </Link>
        ))}
      </nav>
      <Card className="divide-y p-0" data-testid="schools">
        {schools.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noSchool")}</p>}
        {schools.map((s) => (
          <Link
            key={s.id}
            href={`/admin/schools/${s.id}`}
            className="hover:bg-accent flex flex-wrap items-center gap-x-4 gap-y-1 p-4"
            data-testid="school-row"
          >
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">{s.name}</p>
              <p className="text-muted-foreground text-xs">
                {s.slug}
                {s.city ? ` · ${s.city}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>{s.plan}</span>
              {s.status && <Badge variant={STATUS_VARIANT[s.status]}>{t(`statuses.${s.status}`)}</Badge>}
            </div>
            <div className="text-muted-foreground w-full text-xs sm:w-auto sm:text-right">
              {t("studentsOf", { count: s.students, max: s.maxStudents ?? "∞" })} ·{" "}
              {t("whatsappOf", { count: s.whatsapp, max: s.whatsappQuota ?? "∞" })}
              {s.status === "TRIAL" && s.trialEndsAt && (
                <span className="block">{t("trialUntil", { date: date.format(s.trialEndsAt) })}</span>
              )}
            </div>
          </Link>
        ))}
      </Card>
    </div>
  );
}
