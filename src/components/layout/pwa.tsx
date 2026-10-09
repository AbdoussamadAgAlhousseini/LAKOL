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
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
      className="bg-foreground text-background fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 px-4 py-2 text-sm"
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
