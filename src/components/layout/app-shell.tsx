import type { CSSProperties, ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, Menu } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { SchoolContext } from "@/server/context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "./locale-switcher";
import { LogoutButton } from "./logout-button";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";
import { visibleNav } from "./nav";

export async function AppShell({ ctx, locale, children }: { ctx: SchoolContext; locale: string; children: ReactNode }) {
  const t = await getTranslations("common");
  const tr = await getTranslations("roles");
  const tn = await getTranslations("nav");
  const items = visibleNav(ctx.scope).map((item) => ({
    href: `/${ctx.school.slug}/${item.segment}`,
    label: tn(item.key),
    icon: item.key,
  }));
  const roleLabel = tr.has(ctx.activeRole) ? tr(ctx.activeRole) : ctx.activeRole;
  // Couleur de l'établissement appliquée comme couleur principale de l'interface.
  const brand = { "--primary": ctx.school.primaryColor, "--ring": ctx.school.primaryColor } as CSSProperties;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row" style={brand}>
      <aside className="bg-card hidden w-64 shrink-0 flex-col border-r md:flex">
        <SchoolHeader ctx={ctx} roleLabel={roleLabel} />
        <nav className="flex-1 overflow-y-auto p-2">
          <NavLinks items={items} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2 backdrop-blur">
          {/* Menu mobile sans JavaScript : léger sur les téléphones d'entrée de gamme */}
          <details className="group md:hidden">
            <summary className="hover:bg-accent flex size-10 cursor-pointer list-none items-center justify-center rounded-md">
              <Menu aria-hidden />
              <span className="sr-only">{t("menu")}</span>
            </summary>
            <div className="bg-card fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto border-t p-2">
              <SchoolHeader ctx={ctx} roleLabel={roleLabel} />
              <NavLinks items={items} />
            </div>
          </details>
          <span className="truncate font-semibold md:hidden">{ctx.school.shortName ?? ctx.school.name}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/spaces" aria-label={t("switchSpace")} title={t("switchSpace")}>
                <ArrowLeftRight />
              </Link>
            </Button>
            <LocaleSwitcher />
            <ThemeToggle />
            <LogoutButton locale={locale} className="hidden sm:block" />
          </div>
        </header>
        {ctx.readOnly && (
          <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
            {t("readOnly")}
          </Alert>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function SchoolHeader({ ctx, roleLabel }: { ctx: SchoolContext; roleLabel: string }) {
  return (
    <div className="flex items-center gap-3 border-b p-4">
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white"
        style={{ backgroundColor: ctx.school.primaryColor }}
        aria-hidden
      >
        {(ctx.school.shortName ?? ctx.school.name).charAt(0)}
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">{ctx.school.name}</p>
        <p className="text-muted-foreground truncate text-sm" data-testid="active-role">
          {ctx.user.firstName} · {roleLabel}
        </p>
      </div>
    </div>
  );
}
