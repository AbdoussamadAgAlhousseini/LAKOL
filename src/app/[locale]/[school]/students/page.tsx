import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FileUp, Inbox, Plus, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can, canAll } from "@/server/rbac/policies";
import { listStudents } from "@/server/services/students";
import { classOptions } from "@/server/services/options";
import { countPendingPreRegistrations } from "@/server/services/preregistrations";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { ExportLink } from "@/components/layout/export-link";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "./status-badge";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("students"))("title") };
}

type Search = { q?: string; classId?: string; status?: string; page?: string };
const STATUSES = ["ACTIVE", "TRANSFERRED", "DROPPED", "EXPELLED", "GRADUATED"] as const;

export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "student.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const [t, te, { items, total, page }, classes, pending] = await Promise.all([
    getTranslations("students"),
    getTranslations("enums"),
    listStudents(ctx, { q: sp.q, classId: sp.classId, status, page: Number(sp.page) || 1 }),
    classOptions(ctx),
    can(ctx.scope, "student.write") ? countPendingPreRegistrations(ctx) : Promise.resolve(0),
  ]);
  const base = `/${school}/students`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("count", { count: total })}
        actions={
          <>
            {canAll(ctx.scope, "student.read") && <ExportLink href={`/api/schools/${school}/exports/students`} />}
            {can(ctx.scope, "student.write") && (
              <Button variant="outline" asChild>
                <Link href={`${base}/pre-registrations`}>
                  <Inbox /> {t("preRegistrations")}
                  {pending > 0 && <Badge variant="warning">{pending}</Badge>}
                </Link>
              </Button>
            )}
            {can(ctx.scope, "student.import") && (
              <Button variant="outline" asChild>
                <Link href={`${base}/import`}>
                  <FileUp /> {t("import")}
                </Link>
              </Button>
            )}
            {can(ctx.scope, "student.write") && (
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus /> {t("new")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto]" role="search">
        <Input name="q" defaultValue={sp.q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        <Select name="classId" defaultValue={sp.classId ?? ""} aria-label={t("class")}>
          <option value="">{t("allClasses")}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status ?? ""} aria-label={t("status")}>
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {te(`studentStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" className="h-12">
          <Search /> {t("search")}
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>
      ) : (
        <Card className="divide-y p-0">
          {items.map((s) => {
            const guardian = s.guardians[0]?.guardian;
            return (
              <Link
                key={s.id}
                href={`${base}/${s.id}`}
                className="hover:bg-accent flex items-center gap-3 p-4"
                data-testid="student-row"
              >
                <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full font-semibold">
                  {s.firstName.charAt(0)}
                  {s.lastName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.lastName} {s.firstName}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {s.matricule}
                    {s.enrollments[0] ? ` · ${s.enrollments[0].class.name}` : ""}
                    {guardian ? ` · ${guardian.phone}` : ""}
                  </p>
                </div>
                {s.status !== "ACTIVE" && <StatusBadge status={s.status} />}
              </Link>
            );
          })}
        </Card>
      )}
      <Pagination basePath={base} page={page} total={total} params={{ q: sp.q, classId: sp.classId, status }} />
    </>
  );
}
