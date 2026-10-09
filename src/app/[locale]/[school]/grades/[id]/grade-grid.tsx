"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { cn } from "@/lib/utils";
import { saveGradesAction } from "../actions";

interface Row {
  id: string;
  name: string;
  value: string;
}

/**
 * Grille de saisie rapide : une ligne par élève, « Entrée » passe à l'élève
 * suivant. « abs » = absent ; vide = non noté. Les valeurs hors barème sont
 * signalées avant l'envoi.
 */
export function GradeGrid({
  school,
  assessmentId,
  outOf,
  rows,
  disabled,
}: {
  school: string;
  assessmentId: string;
  outOf: number;
  rows: Row[];
  disabled: boolean;
}) {
  const t = useTranslations("grades");
  const initial = useRef(new Map(rows.map((r) => [r.id, r.value])));
  const [values, setValues] = useState(() => new Map(rows.map((r) => [r.id, r.value])));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const invalid = (v: string) => {
    const x = v.trim().toLowerCase();
    if (x === "" || x === "abs" || x === "a") return false;
    if (!/^\d{1,2}([.,]\d{1,2})?$/.test(x)) return true;
    return Number(x.replace(",", ".")) > outOf;
  };
  const cleared = rows
    .filter((r) => initial.current.get(r.id) !== "" && (values.get(r.id) ?? "") === "")
    .map((r) => r.id);
  const filled = [...values.values()].filter((v) => v.trim() !== "").length;

  return (
    <ActionForm action={saveGradesAction} school={school} successMessage={t("saved")} className="gap-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="cleared" value={cleared.join(",")} />
      <p className="text-muted-foreground text-sm">{t("gridHint", { outOf })}</p>
      <ol className="flex flex-col divide-y rounded-lg border" data-testid="grade-grid">
        {rows.map((r, i) => {
          const v = values.get(r.id) ?? "";
          return (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">{i + 1}</span>
              <label htmlFor={`g-${r.id}`} className="flex-1 font-medium">
                {r.name}
              </label>
              <input
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                id={`g-${r.id}`}
                name={`grade_${r.id}`}
                value={v}
                disabled={disabled}
                inputMode="decimal"
                enterKeyHint={i === rows.length - 1 ? "done" : "next"}
                autoComplete="off"
                aria-invalid={invalid(v) || undefined}
                onChange={(e) => setValues(new Map(values).set(r.id, e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && i < rows.length - 1) {
                    e.preventDefault();
                    inputs.current[i + 1]?.focus();
                    inputs.current[i + 1]?.select();
                  }
                }}
                className={cn(
                  "border-input bg-background focus-visible:ring-ring h-12 w-24 rounded-md border px-3 text-right text-lg tabular-nums focus-visible:ring-2 focus-visible:outline-none",
                  invalid(v) && "border-destructive bg-destructive/10",
                )}
              />
              <span className="text-muted-foreground w-8 text-sm">/{outOf}</span>
            </li>
          );
        })}
      </ol>
      <div className="bg-background/95 sticky bottom-0 flex items-center gap-3 border-t py-3 backdrop-blur">
        <span className="flex-1 text-sm">{t("filled", { filled, total: rows.length })}</span>
        <SubmitButton size="lg" disabled={disabled || rows.some((r) => invalid(values.get(r.id) ?? ""))}>
          {t("saveGrades")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
