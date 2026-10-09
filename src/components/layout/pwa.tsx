"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Enregistre le service worker et affiche un bandeau quand le téléphone est hors ligne. */
export function PwaSupport() {
  const t = useTranslations("pwa");
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((registration) => {
          const urls = performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .filter((u) => u.includes("/_next/static/"));
          registration.active?.postMessage({ type: "cache-assets", urls });
        })
        .catch(() => undefined);
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      // Pastille sous l'en-tête, qui laisse passer les clics : elle ne doit jamais masquer
      // un bouton (ex. « Valider l'appel », en bas de l'écran pendant l'appel hors ligne).
      className="bg-foreground/90 text-background pointer-events-none fixed top-16 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-1.5 text-xs shadow-lg"
      data-testid="offline-banner"
    >
      <WifiOff className="size-4" aria-hidden /> {t("offline")}
    </div>
  );
}

/** Bouton « Installer l'application », visible quand le navigateur le propose. */
export function InstallButton() {
  const t = useTranslations("pwa");
  const [event, setEvent] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (!event) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("install")}
      title={t("install")}
      onClick={async () => {
        await event.prompt();
        await event.userChoice;
        setEvent(null);
      }}
    >
      <Download />
    </Button>
  );
}
