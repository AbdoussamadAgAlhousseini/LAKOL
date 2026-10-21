import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FileUp, Plus, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { listStaff } from "@/server/services/staff";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("staff"))("title") };
}

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ q?: string; inactive?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "staff.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const inactive = sp.inactive === "1";
  const [t, tr, te, { items, total, page }] = await Promise.all([
    getTranslations("staff"),
    getTranslations("roles"),
    getTranslations("enums"),
    listStaff(ctx, { q: sp.q, inactive, page: Number(sp.page) || 1 }),
  ]);
  const base = `/${school}/staff`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("count", { count: total })}
        actions={
          can(ctx.scope, "staff.write") && (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href={`${base}/import`}>
                  <FileUp /> {t("import")}
                </Link>
              </Button>
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus /> {t("new")}
                </Link>
              </Button>
            </div>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <form className="flex flex-1 gap-2" role="search">
          {inactive && <input type="hidden" name="inactive" value="1" />}
          <Input
            name="q"
            defaultValue={sp.q}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
          />
          <Button type="submit" variant="secondary" className="h-12" aria-label={t("search")}>
            <Search />
          </Button>
        </form>
        <nav className="flex gap-2">
          {[false, true].map((v) => (
            <Link
              key={String(v)}
              href={v ? `${base}?inactive=1` : base}
              className={cn(
                "flex h-12 items-center rounded-full border px-4 text-sm",
                v === inactive && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {v ? t("inactive") : t("active")}
            </Link>
          ))}
        </nav>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>
      ) : (
        <Card className="divide-y p-0">
          {items.map((s) => (
            <Link
              key={s.id}
              href={`${base}/${s.id}`}
              className="hover:bg-accent flex items-center gap-3 p-4"
              data-testid="staff-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {s.lastName} {s.firstName}
                </p>
                <p className="text-muted-foreground truncate text-sm">
                  {s.position} · {te(`contract.${s.contractType}`)}
                  {s.teachingAssignments.length > 0 &&
                    ` · ${s.teachingAssignments.map((a) => a.subject.name).join(", ")}`}
                </p>
              </div>
              <div className="hidden flex-wrap justify-end gap-1 sm:flex">
                {s.user?.roles.map((r) => (
                  <Badge key={r.id} variant="outline">
                    {tr.has(r.role.key) ? tr(r.role.key) : r.role.name}
                  </Badge>
                ))}
              </div>
            </Link>
          ))}
        </Card>
      )}
      <Pagination
        basePath={base}
        page={page}
        total={total}
        params={{ q: sp.q, inactive: inactive ? "1" : undefined }}
      />
    </>
  );
}
