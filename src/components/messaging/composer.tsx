"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Mic, Send, Square, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/server/action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Action = (slug: string, form: FormData) => Promise<ActionResult<unknown>>;

const MAX_SECONDS = 180;

/** Type audio pris en charge par le navigateur (webm sur Android/Chrome, mp4 sur iOS). */
function recorderType() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

/**
 * Zone de saisie d'un message : texte et/ou message vocal enregistré au
 * micro (utile pour les parents qui écrivent peu le français).
 */
export function Composer({
  action,
  school,
  fields,
  redirectTo,
  placeholder,
}: {
  action: Action;
  school: string;
  fields: Record<string, string>;
  redirectTo?: string;
  placeholder?: string;
}) {
  const t = useTranslations("messages");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio) : null), [audio]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setCanRecord(Boolean(recorderType() && navigator.mediaDevices?.getUserMedia));
    return () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = recorderType()!;
      const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setAudio(new Blob(chunks, { type: mimeType.split(";")[0] }));
      };
      rec.start();
      recorder.current = rec;
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError(t("micDenied"));
    }
  }

  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() && !audio) return setError(te("emptyMessage"));
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    data.set("body", body);
    if (audio) {
      const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
      data.set("audio", new File([audio], `vocal.${ext}`, { type: audio.type }));
    }
    start(async () => {
      const res = await action(school, data);
      if (!res.ok) {
        setError(res.error === "domain" && res.code && te.has(res.code) ? te(res.code) : te("generic"));
        return;
      }
      setBody("");
      setAudio(null);
      setError(null);
      const id = (res.data as { id?: string } | null)?.id ?? "";
      if (redirectTo) router.push(redirectTo.replace("{id}", id));
      else router.refresh();
    });
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="composer">
      {error && <Alert variant="destructive">{error}</Alert>}
      <label htmlFor="message-body" className="sr-only">
        {t("message")}
      </label>
      <Textarea
        id="message-body"
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? t("placeholder")}
        maxLength={4000}
        className="min-h-20"
      />
      {audioUrl && !recording && (
        <div className="flex items-center gap-2">
          <audio controls src={audioUrl} className="h-10 max-w-full flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setAudio(null)}
            aria-label={t("deleteVoice")}
          >
            <Trash2 />
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        {canRecord &&
          (recording ? (
            <Button type="button" variant="destructive" onClick={stopRecording} className="h-12">
              <Square aria-hidden /> {t("stop")} {mmss}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={startRecording} className="h-12" disabled={pending}>
              <Mic aria-hidden /> {audio ? t("reRecord") : t("record")}
            </Button>
          ))}
        <Button type="submit" className="ml-auto h-12" disabled={pending || recording}>
          <Send aria-hidden /> {t("send")}
        </Button>
      </div>
    </form>
  );
}
