import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can, canAll } from "@/server/rbac/policies";
import { getActiveYear } from "@/server/services/structure";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("classes"))("title") };
}

export default async function ClassesPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "student.read"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("classes");
  const all = canAll(ctx.scope, "student.read");
  const year = await getActiveYear(ctx);
  const classes = year
    ? await ctx.db.class.findMany({
        where: { academicYearId: year.id, ...(all ? {} : { id: { in: [...ctx.scope.classIds] } }) },
        include: {
          level: true,
          headTeacher: true,
          _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
        },
        orderBy: [{ level: { order: "asc" } }, { name: "asc" }],
      })
    : [];

  return (
    <>
      <PageHeader title={all ? t("title") : t("myTitle")} description={year?.name} />
      {classes.length === 0 && <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => (
          <Link key={c.id} href={`/${school}/classes/${c.id}`} data-testid="class-card">
            <Card className="hover:bg-accent h-full transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {c.name}
                  {c.headTeacherId && c.headTeacherId === ctx.staffId && (
                    <Badge variant="secondary">{t("youAreHead")}</Badge>
                  )}
                </CardTitle>
                <p className="text-muted-foreground text-sm">
                  {c.level.name} · {t("count", { count: c._count.enrollments })}
                  {c.headTeacher && (
                    <span className="block">
                      {t("headTeacher")} : {c.headTeacher.firstName} {c.headTeacher.lastName}
                    </span>
                  )}
                </p>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
