import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentSession } from "@/server/auth/session";
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
  if ((await getCurrentSession())?.user.mustChangePwd) redirect({ href: "/account/password", locale });
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  return (
    <AppShell ctx={ctx} locale={locale}>
      {children}
    </AppShell>
  );
}
