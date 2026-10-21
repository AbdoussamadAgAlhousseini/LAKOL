"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, Td, Th } from "@/components/ui/table";
import type { ActionResult } from "@/server/action";
import { checkImportAction, runImportAction, type ImportPreview } from "../actions";

/** Import en deux temps : vérification ligne par ligne, puis import. */
export function ImportForm({ school }: { school: string }) {
  const t = useTranslations("import");
  const te = useTranslations("errors");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function describe(res: ActionResult<unknown>) {
    if (res.ok) return null;
    return res.error === "domain" && res.code && te.has(res.code) ? te(res.code) : te(res.error);
  }

  function check() {
    const data = new FormData(formRef.current!);
    setDone(null);
    start(async () => {
      const res = await checkImportAction(school, data);
      setError(describe(res));
      setPreview(res.ok ? res.data : null);
    });
  }

  function run() {
    const data = new FormData(formRef.current!);
    start(async () => {
      const res = await runImportAction(school, data);
      setError(describe(res));
      if (res.ok) {
        setDone(res.data.created);
        setPreview(null);
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  const errors = preview?.filter((r) => r.errors.length > 0) ?? [];
  const label = (code: string) => {
    const [kind, column] = code.split(":");
    return column ? t(`errorLabels.${kind}`, { column }) : t(`errorLabels.${kind}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} onSubmit={(e) => (e.preventDefault(), check())} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="file">{t("file")}</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            required
            className="pt-3"
            onChange={() => setPreview(null)}
          />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="sendAccess" defaultChecked className="accent-primary size-5" />
          {t("sendAccess")}
        </label>
        <Button type="submit" variant="outline" disabled={pending} className="self-start">
          {t("check")}
        </Button>
      </form>

      {error && <Alert variant="destructive">{error}</Alert>}
      {done !== null && <Alert variant="success">{t("done", { count: done })}</Alert>}

      {preview && (
        <div className="flex flex-col gap-4" aria-live="polite">
          <div className="flex flex-wrap gap-4 text-sm font-medium">
            <span className="text-success flex items-center gap-1">
              <CheckCircle2 className="size-5" /> {t("rowsOk", { count: preview.length - errors.length })}
            </span>
            {errors.length > 0 && (
              <span className="text-destructive flex items-center gap-1">
                <XCircle className="size-5" /> {t("rowsKo", { count: errors.length })}
              </span>
            )}
          </div>
          {errors.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t("line")}</Th>
                  <Th>{t("student")}</Th>
                  <Th>{t("errors")}</Th>
                </tr>
              </thead>
              <tbody>
                {errors.map((r) => (
                  <tr key={r.line}>
                    <Td>{r.line}</Td>
                    <Td>
                      {r.values.nom} {r.values.prenom}
                    </Td>
                    <Td className="text-destructive">
                      {r.errors
                        .map((e) =>
                          e === "unknownClass"
                            ? t("errorLabels.unknownClass", { name: r.values.classe ?? "" })
                            : label(e),
                        )
                        .join(" · ")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          {errors.some((r) => r.errors.includes("unknownClass")) && <Alert>{t("unknownClassHelp")}</Alert>}
          {errors.length === 0 && (
            <Button onClick={run} disabled={pending} size="lg" className="self-start">
              {t("confirm", { count: preview.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
