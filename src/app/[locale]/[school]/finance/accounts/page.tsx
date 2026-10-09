import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listStudents } from "@/server/services/students";
import { classOptions } from "@/server/services/options";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FinanceNav } from "../finance-nav";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("finance.tabs"))("accounts") };
}

/** Recherche d'un élève pour encaisser ou consulter son compte. */
export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ q?: string; classId?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "finance.read"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [t, { items, total, page }, classes] = await Promise.all([
    getTranslations("finance"),
    listStudents(ctx, { q: sp.q, classId: sp.classId, page: Number(sp.page) || 1 }),
    classOptions(ctx),
  ]);
  return (
    <>
      <PageHeader title={t("tabs.accounts")} description={t("accountsIntro")} />
      <FinanceNav ctx={ctx} school={school} active="accounts" />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_auto]" role="search">
        <Input
          name="q"
          defaultValue={sp.q}
          placeholder={t("searchStudent")}
          aria-label={t("searchStudent")}
          autoFocus
        />
        <Select name="classId" defaultValue={sp.classId ?? ""} aria-label={t("class")}>
          <option value="">{t("allClasses")}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" className="h-12">
          <Search /> {t("search")}
        </Button>
      </form>
      <Card className="divide-y p-0">
        {items.map((s) => (
          <Link
            key={s.id}
            href={`/${school}/finance/students/${s.id}`}
            className="hover:bg-accent flex items-center gap-3 p-4"
            data-testid="account-row"
          >
            <span className="flex-1 font-medium">
              {s.lastName} {s.firstName}
            </span>
            <span className="text-muted-foreground text-sm">
              {s.matricule}
              {s.enrollments[0] && ` · ${s.enrollments[0].class.name}`}
            </span>
          </Link>
        ))}
      </Card>
      <Pagination
        basePath={`/${school}/finance/accounts`}
        page={page}
        total={total}
        params={{ q: sp.q, classId: sp.classId }}
      />
    </>
  );
}
