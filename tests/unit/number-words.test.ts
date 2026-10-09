import { describe, expect, it } from "vitest";
import { amountInWords, numberToWords } from "@/lib/number-words";

describe("nombres en lettres", () => {
  it.each([
    [21, "vingt et un"],
    [71, "soixante et onze"],
    [80, "quatre-vingts"],
    [91, "quatre-vingt-onze"],
    [200, "deux cents"],
    [250, "deux cent cinquante"],
    [1000, "mille"],
    [25000, "vingt-cinq mille"],
    [80000, "quatre-vingt mille"],
    [200000, "deux cent mille"],
    [137500, "cent trente-sept mille cinq cents"],
    [1_000_000, "un million"],
    [2_450_000, "deux millions quatre cent cinquante mille"],
  ])("%i -> %s", (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it("ajoute la devise", () => {
    expect(amountInWords(45000)).toBe("quarante-cinq mille francs CFA");
  });
});
