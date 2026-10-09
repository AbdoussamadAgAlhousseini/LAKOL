import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicSchool } from "@/server/platform/preregistration";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PreRegistrationForm } from "./form";

export async function generateMetadata({ params }: { params: Promise<{ school: string }> }): Promise<Metadata> {
  const { school } = await params;
  const data = await getPublicSchool(school);
  const t = await getTranslations("preRegistration.public");
  return { title: data ? t("title", { school: data.school.name }) : undefined };
}

export const dynamic = "force-dynamic";

export default async function PublicPreRegistrationPage({
  params,
}: {
  params: Promise<{ locale: string; school: string }>;
}) {
  const { locale, school } = await params;
  setRequestLocale(locale);
  const data = await getPublicSchool(school);
  if (!data) notFound();
  const t = await getTranslations("preRegistration.public");
  return (
    <div className="min-h-dvh" style={{ ["--primary" as string]: data.school.primaryColor }}>
      <header className="flex items-center justify-between gap-2 border-b p-4">
        <p className="font-bold">{data.school.name}</p>
        <div className="flex gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t("title", { school: data.school.name })}</h1>
        <p className="text-muted-foreground mt-1 mb-6">{t("intro")}</p>
        <PreRegistrationForm school={school} levels={data.levels.map((l) => ({ id: l.id, name: l.name }))} />
      </main>
    </div>
  );
}
