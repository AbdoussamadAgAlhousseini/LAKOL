import { FileSpreadsheet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

/** Lien de téléchargement d'un export Excel (route /api/schools/{école}/exports/…). */
export async function ExportLink({ href, label }: { href: string; label?: string }) {
  const t = await getTranslations("common");
  return (
    <Button variant="outline" asChild>
      <a href={href} download data-testid="export">
        <FileSpreadsheet aria-hidden /> {label ?? t("exportExcel")}
      </a>
    </Button>
  );
}
