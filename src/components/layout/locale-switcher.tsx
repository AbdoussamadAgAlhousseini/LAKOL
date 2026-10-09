"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LABELS: Record<string, string> = { fr: "FR", en: "EN" };

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  return (
    <select
      aria-label={t("language")}
      value={locale}
      onChange={(e) =>
        // @ts-expect-error -- les paramètres dynamiques de la route courante sont conservés tels quels
        router.replace({ pathname, params }, { locale: e.target.value })
      }
      className="border-input bg-background h-10 rounded-md border px-2 text-sm"
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {LABELS[l] ?? l}
        </option>
      ))}
    </select>
  );
}
