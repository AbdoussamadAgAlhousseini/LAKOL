import { describe, expect, it } from "vitest";
import {
  generalAverage,
  normalize,
  parseScoreInput,
  ranks,
  stats,
  subjectAverage,
  suggestDistinction,
} from "@/lib/grading";

describe("calcul des moyennes", () => {
  it("ramène une note sur 10 au barème sur 20", () => {
    expect(normalize(750, 10, 20)).toBe(1500);
  });

  it("pondère les évaluations et ignore les absences", () => {
    // Interro 12/20 (poids 1), composition 15/20 (poids 2), absent à un devoir
    const avg = subjectAverage(
      [
        { score: 1200, outOf: 20, weight: 1 },
        { score: 1500, outOf: 20, weight: 2 },
        { score: null, outOf: 20, weight: 1 },
      ],
      20,
    );
    expect(avg).toBe(1400);
    expect(subjectAverage([{ score: null, outOf: 20, weight: 1 }], 20)).toBeNull();
  });

  it("calcule la moyenne générale avec les coefficients", () => {
    // Maths 16 (coef 3), Français 10 (coef 2), EPS sans note
    expect(
      generalAverage([
        { average: 1600, coefficient: 3 },
        { average: 1000, coefficient: 2 },
        { average: null, coefficient: 1 },
      ]),
    ).toBe(1360);
  });

  it("classe avec ex æquo", () => {
    const r = ranks(
      new Map([
        ["a", 1500],
        ["b", 1200],
        ["c", 1500],
        ["d", 900],
        ["e", null],
      ]),
    );
    expect([r.get("a"), r.get("c"), r.get("b"), r.get("d"), r.get("e")]).toEqual([1, 1, 3, 4, null]);
  });

  it("donne moyenne de classe, plus forte et plus faible", () => {
    expect(stats([1200, 1500, null, 900])).toEqual({ average: 1200, highest: 1500, lowest: 900 });
  });

  it("propose une distinction selon la moyenne", () => {
    expect(suggestDistinction(1650, 20)).toBe("CONGRATULATIONS");
    expect(suggestDistinction(720, 10)).toBe("HONOR_ROLL");
    expect(suggestDistinction(1100, 20)).toBeNull();
  });

  it("lit la saisie du professeur", () => {
    expect(parseScoreInput("13,5")).toEqual({ score: 1350, absent: false });
    expect(parseScoreInput("abs")).toEqual({ score: null, absent: true });
    expect(parseScoreInput("")).toEqual({ score: null, absent: false });
    expect(parseScoreInput("vingt")).toBe("invalid");
  });
});
