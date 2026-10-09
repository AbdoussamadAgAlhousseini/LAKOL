import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 p-4">
        <LocaleSwitcher />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pb-16">
        <div className="mb-8 text-center">
          <p className="text-primary text-3xl font-extrabold tracking-tight">{t("appName")}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t("tagline")}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
