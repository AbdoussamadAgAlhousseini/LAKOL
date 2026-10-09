"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CloudOff, Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveRollCallAction } from "../actions";

type Status = "PRESENT" | "ABSENT" | "LATE";
interface Student {
  id: string;
  firstName: string;
  lastName: string;
  status: string | null;
}
interface Pending {
  school: string;
  classId: string;
  date: string;
  slotId?: string;
  entries: { studentId: string; status: Status; clientId: string }[];
}

const QUEUE_KEY = "lakol:attendance-queue";

function readQueue(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Pending[];
  } catch {
    return [];
  }
}

function writeQueue(queue: Pending[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // stockage indisponible (navigation privée) : on ne peut rien garder
  }
}

async function send(p: Pending) {
  const form = new FormData();
  form.set("classId", p.classId);
  form.set("date", p.date);
  if (p.slotId) form.set("slotId", p.slotId);
  form.set("entries", JSON.stringify(p.entries));
  return saveRollCallAction(p.school, form);
}

/**
 * Appel en quelques touches : tout le monde est présent par défaut, on touche
 * les absents et les retards. Hors connexion, l'appel est gardé sur le
 * téléphone et envoyé automatiquement au retour du réseau (identifiants
 * uniques : pas de doublon côté serveur).
 */
export function RollCall({
  school,
  classId,
  date,
  slotId,
  students,
}: {
  school: string;
  classId: string;
  date: string;
  slotId?: string;
  students: Student[];
}) {
  const t = useTranslations("attendance");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [statuses, setStatuses] = useState<Record<string, Status>>(() =>
    Object.fromEntries(
      students.map((s) => [s.id, (s.status === "ABSENT" || s.status === "LATE" ? s.status : "PRESENT") as Status]),
    ),
  );
  const [message, setMessage] = useState<{ kind: "success" | "offline" | "error"; text: string } | null>(null);
  const [queued, setQueued] = useState(0);

  const flush = useCallback(async () => {
    const queue = readQueue();
    if (queue.length === 0) return;
    const remaining: Pending[] = [];
    for (const p of queue) {
      try {
        const res = await send(p);
        if (!res.ok && res.error !== "invalid" && res.error !== "forbidden") remaining.push(p);
      } catch {
        remaining.push(p);
      }
    }
    writeQueue(remaining);
    setQueued(remaining.length);
    if (remaining.length < queue.length) setMessage({ kind: "success", text: t("synced") });
  }, [t]);

  useEffect(() => {
    setQueued(readQueue().length);
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  const cycle = (id: string) =>
    setStatuses((s) => ({ ...s, [id]: s[id] === "PRESENT" ? "ABSENT" : s[id] === "ABSENT" ? "LATE" : "PRESENT" }));

  function submit() {
    const stamp = Date.now().toString(36);
    const payload: Pending = {
      school,
      classId,
      date,
      slotId,
      entries: students.map((s) => ({
        studentId: s.id,
        status: statuses[s.id],
        clientId: `${s.id}-${date}-${slotId ?? "day"}-${stamp}`,
      })),
    };
    start(async () => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const res = await send(payload);
        if (!res.ok) {
          setMessage({
            kind: "error",
            text: res.error === "domain" && res.code && te.has(res.code) ? te(res.code) : te(res.error),
          });
          return;
        }
        setMessage({ kind: "success", text: t("saved", { notified: res.data.notified }) });
        router.refresh();
      } catch {
        writeQueue([...readQueue(), payload]);
        setQueued(readQueue().length);
        setMessage({ kind: "offline", text: t("savedOffline") });
      }
    });
  }

  const absent = Object.values(statuses).filter((s) => s === "ABSENT").length;
  const late = Object.values(statuses).filter((s) => s === "LATE").length;

  return (
    <div className="flex flex-col gap-4">
      {queued > 0 && (
        <Alert>
          <CloudOff /> {t("queued", { count: queued })}
        </Alert>
      )}
      <p className="text-muted-foreground text-sm">{t("tapHint")}</p>
      <ul className="flex flex-col gap-2" data-testid="roll-call">
        {students.map((s) => {
          const status = statuses[s.id];
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => cycle(s.id)}
                aria-pressed={status !== "PRESENT"}
                data-status={status}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-4 text-left text-base transition-colors",
                  status === "PRESENT" && "border-border bg-card",
                  status === "ABSENT" && "border-destructive bg-destructive/10",
                  status === "LATE" && "border-warning bg-warning/15",
                )}
              >
                <span className="flex-1 font-medium">
                  {s.lastName} {s.firstName}
                </span>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-semibold",
                    status === "PRESENT" && "bg-success/15 text-success",
                    status === "ABSENT" && "bg-destructive text-white",
                    status === "LATE" && "bg-warning text-black",
                  )}
                >
                  {t(`status.${status}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="bg-background/95 sticky bottom-0 flex flex-col gap-2 border-t py-3 backdrop-blur">
        {message && (
          <Alert
            variant={message.kind === "error" ? "destructive" : message.kind === "success" ? "success" : "default"}
          >
            {message.text}
          </Alert>
        )}
        <p className="text-sm">{t("summary", { present: students.length - absent - late, absent, late })}</p>
        <Button size="lg" onClick={submit} disabled={pending}>
          <Check /> {t("submit")}
        </Button>
      </div>
    </div>
  );
}
