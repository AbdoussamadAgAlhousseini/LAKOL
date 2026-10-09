import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight, School, ShieldCheck } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentSession } from "@/server/auth/session";
import { listSpaces } from "@/server/context";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { LogoutButton } from "@/components/layout/logout-button";
import { switchSpaceAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("spaces");
  return { title: t("title") };
}

export default async function SpacesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const current = await getCurrentSession();
  if (!current) return redirect({ href: "/login", locale });

  const spaces = await listSpaces(current.user.id);
  const isPlatformAdmin = current.user.isPlatformAdmin;
  if (spaces.length === 1 && !isPlatformAdmin) {
    return redirect({ href: `/${spaces[0].schoolSlug}/dashboard`, locale });
  }

  const t = await getTranslations("spaces");
  const tr = await getTranslations("roles");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {spaces.length === 0 && !isPlatformAdmin && <Alert>{t("none")}</Alert>}

      <div className="flex flex-col gap-3">
        {isPlatformAdmin && (
          <Card className="p-0">
            <Link href="/admin" className="flex items-center gap-4 p-4">
              <ShieldCheck className="text-primary size-8" aria-hidden />
              <span className="flex-1 font-semibold">{t("platform")}</span>
              <ChevronRight aria-hidden />
            </Link>
          </Card>
        )}
        {spaces.map((space) => (
          <Card key={`${space.schoolId}-${space.roleKey}`} className="p-0">
            <form action={switchSpaceAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="school" value={space.schoolSlug} />
              <input type="hidden" name="role" value={space.roleKey} />
              <button type="submit" className="flex w-full items-center gap-4 p-4 text-left">
                <School className="text-primary size-8" aria-hidden />
                <span className="flex-1">
                  <span className="block font-semibold">{space.schoolName}</span>
                  <span className="text-muted-foreground text-sm">
                    {tr.has(space.roleKey) ? tr(space.roleKey) : space.roleName}
                  </span>
                </span>
                <ChevronRight aria-hidden />
              </button>
            </form>
          </Card>
        ))}
      </div>

      <LogoutButton locale={locale} className="self-center" />
    </main>
  );
}
