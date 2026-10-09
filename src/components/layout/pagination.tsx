import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE } from "@/server/services/context";

/** Pagination par liens (fonctionne sans JavaScript), conserve les filtres. */
export async function Pagination({
  basePath,
  page,
  total,
  params,
}: {
  basePath: string;
  page: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  const t = await getTranslations("form");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const query = new URLSearchParams(
      Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => Boolean(e[1])),
    );
    return `${basePath}?${query}`;
  };
  return (
    <nav className="mt-4 flex items-center justify-between gap-2" aria-label={t("pagination")}>
      <Button variant="outline" asChild={page > 1} disabled={page <= 1}>
        {page > 1 ? (
          <Link href={href(page - 1)}>
            <ChevronLeft /> {t("previous")}
          </Link>
        ) : (
          <span>
            <ChevronLeft /> {t("previous")}
          </span>
        )}
      </Button>
      <span className="text-muted-foreground text-sm">{t("pageOf", { page, pages })}</span>
      <Button variant="outline" asChild={page < pages} disabled={page >= pages}>
        {page < pages ? (
          <Link href={href(page + 1)}>
            {t("next")} <ChevronRight />
          </Link>
        ) : (
          <span>
            {t("next")} <ChevronRight />
          </span>
        )}
      </Button>
    </nav>
  );
}
