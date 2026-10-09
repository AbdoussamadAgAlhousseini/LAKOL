// Calculs des notes. Tout est en entiers « centièmes » (13,75 -> 1375) sur
// le barème de l'école (10 ou 20). Aucun flottant n'est stocké.

export interface GradeInput {
  studentId: string;
  /** Note en centièmes sur `outOf`, null si absent / non noté. */
  score: number | null;
  outOf: number;
  weight: number;
}

/** Ramène une note au barème de l'école, en centièmes. */
export function normalize(score: number, outOf: number, scale: number): number {
  return Math.round((score * scale) / outOf);
}

/** Moyenne pondérée d'un élève dans une matière ; null sans aucune note. */
export function subjectAverage(grades: Omit<GradeInput, "studentId">[], scale: number): number | null {
  let sum = 0;
  let weights = 0;
  for (const g of grades) {
    if (g.score === null || g.weight <= 0) continue;
    sum += normalize(g.score, g.outOf, scale) * g.weight;
    weights += g.weight;
  }
  return weights === 0 ? null : Math.round(sum / weights);
}

/** Moyenne générale coefficientée ; les matières sans moyenne sont ignorées. */
export function generalAverage(subjects: { average: number | null; coefficient: number }[]): number | null {
  let sum = 0;
  let coefs = 0;
  for (const s of subjects) {
    if (s.average === null || s.coefficient <= 0) continue;
    sum += s.average * s.coefficient;
    coefs += s.coefficient;
  }
  return coefs === 0 ? null : Math.round(sum / coefs);
}

/** Rangs : 1 = meilleur, ex æquo au même rang (1, 2, 2, 4). Les absents de moyenne n'ont pas de rang. */
export function ranks(values: Map<string, number | null>): Map<string, number | null> {
  const sorted = [...values.entries()].filter((e): e is [string, number] => e[1] !== null).sort((a, b) => b[1] - a[1]);
  const result = new Map<string, number | null>();
  sorted.forEach(([id, value], i) => {
    const previous = sorted[i - 1];
    result.set(id, previous && previous[1] === value ? result.get(previous[0])! : i + 1);
  });
  for (const id of values.keys()) if (!result.has(id)) result.set(id, null);
  return result;
}

export function stats(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length === 0) return { average: null, highest: null, lowest: null };
  return {
    average: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    highest: Math.max(...v),
    lowest: Math.min(...v),
  };
}

export type SuggestedDistinction = "CONGRATULATIONS" | "HONOR_ROLL" | "ENCOURAGEMENT" | null;

/** Distinction proposée au conseil selon la moyenne (seuils sur 20, ramenés au barème). */
export function suggestDistinction(average: number | null, scale: number): SuggestedDistinction {
  if (average === null) return null;
  const on20 = (average * 20) / scale;
  if (on20 >= 1600) return "CONGRATULATIONS";
  if (on20 >= 1400) return "HONOR_ROLL";
  if (on20 >= 1200) return "ENCOURAGEMENT";
  return null;
}

/** Saisie « 13,5 » ou « 13.5 » -> 1350 ; vide -> null ; « abs » -> absent. */
export function parseScoreInput(raw: string): { score: number | null; absent: boolean } | "invalid" {
  const v = raw.trim().toLowerCase();
  if (v === "") return { score: null, absent: false };
  if (v === "abs" || v === "a") return { score: null, absent: true };
  if (!/^\d{1,2}([.,]\d{1,2})?$/.test(v)) return "invalid";
  return { score: Math.round(Number(v.replace(",", ".")) * 100), absent: false };
}
