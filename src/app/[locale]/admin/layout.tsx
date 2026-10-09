import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeftRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentSession } from "@/server/auth/session";
import { AdminNav } from "@/components/admin/admin-nav";
import { Forbidden } from "@/components/layout/forbidden";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { LogoutButton } from "@/components/layout/logout-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

// Espace super admin de la plateforme : écoles, formules, factures.
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const current = await getCurrentSession();
  if (!current) redirect({ href: "/login", locale });
  if (!current!.user.isPlatformAdmin) return <Forbidden />;
  const t = await getTranslations("admin");
  const tc = await getTranslations("common");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2">
          <span className="text-primary text-lg font-bold">LAKOL</span>
          <span className="text-muted-foreground hidden text-sm sm:inline">{t("title")}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/spaces" aria-label={tc("switchSpace")} title={tc("switchSpace")}>
                <ArrowLeftRight />
              </Link>
            </Button>
            <LocaleSwitcher />
            <ThemeToggle />
            <LogoutButton locale={locale} className="hidden sm:block" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-2">
          <AdminNav
            labels={{
              dashboard: t("nav.dashboard"),
              schools: t("nav.schools"),
              plans: t("nav.plans"),
              invoices: t("nav.invoices"),
            }}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
