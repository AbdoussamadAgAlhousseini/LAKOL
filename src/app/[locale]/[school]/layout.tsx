import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { loadSchoolPage } from "@/server/page-context";
import { AppShell } from "@/components/layout/app-shell";
import { Forbidden } from "@/components/layout/forbidden";

export default async function SchoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; school: string }>;
}) {
  const { locale, school } = await params;
  setRequestLocale(locale);
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  return (
    <AppShell ctx={ctx} locale={locale}>
      {children}
    </AppShell>
  );
}
