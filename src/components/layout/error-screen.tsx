"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Écran affiché quand une page plante : message clair, détail technique à transmettre, bouton pour réessayer. */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  useEffect(() => console.error(error), [error]);
  const detail = [error.message, error.digest && `réf. ${error.digest}`].filter(Boolean).join(" — ");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
      <p className="text-muted-foreground text-sm">{t("errorHelp")}</p>
      {detail && <p className="bg-muted w-full rounded-md p-3 font-mono text-xs break-words">{detail}</p>}
      <div className="flex gap-2">
        <Button onClick={reset}>{t("retry")}</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("reload")}
        </Button>
      </div>
    </div>
  );
}
