import { describe, expect, it } from "vitest";
import { applyBasisPoints, formatMoney } from "@/lib/money";
import { formatScore, rescale } from "@/lib/grades";

const normalize = (s: string) => s.replace(/\s/g, " ");

describe("argent", () => {
  it("formate le FCFA sans décimales", () => {
    expect(normalize(formatMoney(25000, "XOF", "fr"))).toBe("25 000 FCFA");
  });
  it("refuse les montants non entiers", () => {
    expect(() => formatMoney(10.5)).toThrow();
  });
  it("applique un pourcentage en points de base", () => {
    expect(applyBasisPoints(45000, 1000)).toBe(4500);
    expect(applyBasisPoints(33333, 1500)).toBe(5000);
  });
});

describe("notes", () => {
  it("formate les centièmes", () => {
    expect(formatScore(1375, "fr")).toBe("13,75");
    expect(formatScore(null)).toBe("—");
  });
  it("change de barème", () => {
    expect(rescale(700, 10, 20)).toBe(1400);
  });
});
