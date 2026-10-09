import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Construction } from "lucide-react";
import { loadSchoolPage } from "@/server/page-context";
import { NAV_ITEMS, visibleNav } from "@/components/layout/nav";
import { Forbidden } from "@/components/layout/forbidden";

// Modules de la navigation pas encore livrés : page d'attente avec la phase prévue.
export default async function ModulePlaceholder({
  params,
}: {
  params: Promise<{ locale: string; school: string; section: string[] }>;
}) {
  const { locale, school, section } = await params;
  const item = NAV_ITEMS.find((i) => i.segment === section[0]);
  if (!item || section.length > 1) notFound();

  const ctx = await loadSchoolPage(school, locale);
  if (!ctx || !visibleNav(ctx.scope).includes(item)) return <Forbidden />;

  const t = await getTranslations("common");
  const tn = await getTranslations("nav");
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <Construction className="text-warning size-12" aria-hidden />
      <h1 className="text-2xl font-bold">{tn(item.key)}</h1>
      <p className="text-muted-foreground">
        {t("comingSoon")} — {t("comingSoonBody", { phase: item.phase })}
      </p>
    </div>
  );
}
