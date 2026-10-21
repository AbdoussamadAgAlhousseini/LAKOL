import { describe, expect, it } from "vitest";
import { classKey } from "@/server/services/import";

describe("import : noms de classe", () => {
  it("« 7e A », « 7ème A » et « 7e année A » désignent la même classe", () => {
    expect(classKey("7e A")).toBe(classKey("7e année A"));
    expect(classKey("7ème A")).toBe(classKey("7e année A"));
    expect(classKey("1re année A")).toBe(classKey("1ère A"));
    expect(classKey("7e A")).not.toBe(classKey("7e B"));
    expect(classKey("11e TSE")).not.toBe(classKey("11e TSS"));
  });
});
