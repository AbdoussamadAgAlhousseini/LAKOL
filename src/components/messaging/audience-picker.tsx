"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Option = { id: string; name: string };

/** Choix des destinataires d'une annonce ; niveaux et classes selon le type choisi. */
export function AudiencePicker({
  labels,
  levels,
  classes,
}: {
  labels: Record<"audience" | "SCHOOL" | "PARENTS" | "STAFF" | "LEVEL" | "CLASS" | "levels" | "classes", string>;
  levels: Option[];
  classes: Option[];
}) {
  const [audience, setAudience] = useState("SCHOOL");
  const targets = audience === "LEVEL" ? levels : audience === "CLASS" ? classes : null;
  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="audience">{labels.audience}</Label>
        <Select id="audience" name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {(["SCHOOL", "PARENTS", "STAFF", "LEVEL", "CLASS"] as const).map((a) => (
            <option key={a} value={a}>
              {labels[a]}
            </option>
          ))}
        </Select>
      </div>
      {targets && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{audience === "LEVEL" ? labels.levels : labels.classes}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {targets.map((o) => (
              <label key={o.id} className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                <input
                  type="checkbox"
                  name={audience === "LEVEL" ? "levelIds[]" : "classIds[]"}
                  value={o.id}
                  className="accent-primary size-5"
                />
                {o.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
