import { getTranslations } from "next-intl/server";
import { ShieldX } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export async function Forbidden() {
  const t = await getTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <ShieldX className="text-destructive size-14" aria-hidden />
      <h1 className="text-xl font-semibold" data-testid="forbidden">
        {t("forbiddenTitle")}
      </h1>
      <p className="text-muted-foreground">{t("forbiddenBody")}</p>
      <Button asChild>
        <Link href="/spaces">{t("goHome")}</Link>
      </Button>
    </main>
  );
}
