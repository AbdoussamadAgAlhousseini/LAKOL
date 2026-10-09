import { describe, expect, it } from "vitest";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("traductions", () => {
  it("le français et l'anglais ont exactement les mêmes clés", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });
});
