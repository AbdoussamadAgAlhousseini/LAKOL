"use client";

import { useEffect, useState } from "react";
import { Bell, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

type Counts = { notifications: number; messages: number };

/**
 * Compteurs de l'en-tête (notifications, messages non lus), mis à jour en
 * direct par le flux SSE de l'école. Sans SSE, les valeurs du rendu serveur restent.
 */
export function LiveCounters({
  school,
  initial,
  showMessages,
  labels,
}: {
  school: string;
  initial: Counts;
  showMessages: boolean;
  labels: { notifications: string; messages: string };
}) {
  const [counts, setCounts] = useState(initial);
  useEffect(() => setCounts(initial), [initial]);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/schools/${school}/events`);
    source.addEventListener("counts", (e) => {
      try {
        setCounts(JSON.parse((e as MessageEvent<string>).data) as Counts);
      } catch {
        /* message mal formé : ignoré */
      }
    });
    return () => source.close();
  }, [school]);

  return (
    <>
      {showMessages && (
        <CounterLink
          href={`/${school}/messages`}
          label={labels.messages}
          count={counts.messages}
          testId="messages-count"
        >
          <MessageCircle />
        </CounterLink>
      )}
      <CounterLink
        href={`/${school}/notifications`}
        label={labels.notifications}
        count={counts.notifications}
        testId="notifications-count"
      >
        <Bell />
      </CounterLink>
    </>
  );
}

function CounterLink({
  href,
  label,
  count,
  testId,
  children,
}: {
  href: string;
  label: string;
  count: number;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon" asChild className="relative">
      <Link href={href} aria-label={count > 0 ? `${label} (${count})` : label} title={label}>
        {children}
        {count > 0 && (
          <span
            className="bg-destructive absolute top-0.5 right-0.5 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-bold text-white"
            data-testid={testId}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
