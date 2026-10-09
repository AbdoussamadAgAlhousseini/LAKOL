// Modèle de structure scolaire du Mali (enseignement général), appliqué par
// l'assistant de démarrage. Tout reste modifiable ensuite.

export type CycleKey = "MATERNELLE" | "FONDAMENTAL_1" | "FONDAMENTAL_2" | "LYCEE";

export interface TemplateLevel {
  name: string;
  order: number;
  nationalExam?: "DEF" | "BAC";
  /** Comptes élèves (désactivés pour les plus jeunes : seul le parent a accès). */
  studentAccounts: boolean;
  /** Coefficients par code matière. */
  coefficients: Record<string, number>;
  /** Séries (lycée, à partir de la 11e) : une classe par série. */
  tracks?: string[];
}

export interface TemplateCycle {
  key: CycleKey;
  name: string;
  order: number;
  levels: TemplateLevel[];
}

export const MALI_SUBJECTS: { code: string; name: string; color: string }[] = [
  { code: "FR", name: "Français", color: "#2563EB" },
  { code: "MATH", name: "Mathématiques", color: "#DC2626" },
  { code: "PC", name: "Physique-Chimie", color: "#7C3AED" },
  { code: "SVT", name: "Biologie (SVT)", color: "#16A34A" },
  { code: "HG", name: "Histoire-Géographie", color: "#CA8A04" },
  { code: "ANG", name: "Anglais", color: "#0891B2" },
  { code: "ECM", name: "Éducation civique et morale", color: "#9333EA" },
  { code: "EPS", name: "Éducation physique", color: "#EA580C" },
  { code: "PHILO", name: "Philosophie", color: "#475569" },
  { code: "ECO", name: "Économie", color: "#0D9488" },
  { code: "EVEIL", name: "Éveil et langage", color: "#DB2777" },
];

export const MALI_TRACKS: { code: string; name: string }[] = [
  { code: "TSE", name: "Sciences exactes" },
  { code: "TSEXP", name: "Sciences expérimentales" },
  { code: "TLL", name: "Lettres et langues" },
  { code: "TSS", name: "Sciences sociales" },
  { code: "TSECO", name: "Sciences économiques" },
];

const F1 = { FR: 3, MATH: 3, HG: 1, SVT: 1, ECM: 1, EPS: 1 };
const F2 = { FR: 3, MATH: 3, PC: 2, SVT: 2, HG: 2, ANG: 2, ECM: 1, EPS: 1 };
const LYCEE = { FR: 3, MATH: 3, PC: 2, SVT: 2, HG: 2, ANG: 2, PHILO: 2, EPS: 1 };

export const MALI_TEMPLATE: TemplateCycle[] = [
  {
    key: "MATERNELLE",
    name: "Maternelle",
    order: 1,
    levels: ["Petite section", "Moyenne section", "Grande section"].map((name, i) => ({
      name,
      order: i + 1,
      studentAccounts: false,
      coefficients: { EVEIL: 1 },
    })),
  },
  {
    key: "FONDAMENTAL_1",
    name: "Fondamental 1er cycle",
    order: 2,
    levels: [1, 2, 3, 4, 5, 6].map((n) => ({
      name: n === 1 ? "1re année" : `${n}e année`,
      order: 10 + n,
      studentAccounts: n >= 5,
      coefficients: F1,
    })),
  },
  {
    key: "FONDAMENTAL_2",
    name: "Fondamental 2e cycle",
    order: 3,
    levels: [7, 8, 9].map((n) => ({
      name: `${n}e année`,
      order: 10 + n,
      studentAccounts: true,
      coefficients: F2,
      ...(n === 9 ? { nationalExam: "DEF" as const } : {}),
    })),
  },
  {
    key: "LYCEE",
    name: "Lycée",
    order: 4,
    levels: [
      { name: "10e année", order: 20, studentAccounts: true, coefficients: LYCEE },
      {
        name: "11e année",
        order: 21,
        studentAccounts: true,
        coefficients: LYCEE,
        tracks: ["TSE", "TSEXP", "TLL", "TSS"],
      },
      {
        name: "Terminale",
        order: 22,
        nationalExam: "BAC",
        studentAccounts: true,
        coefficients: LYCEE,
        tracks: ["TSE", "TSEXP", "TLL", "TSS"],
      },
    ],
  },
];

/** Année scolaire malienne par défaut : octobre à juin (ex. « 2026-2027 »). */
export function defaultSchoolYear(today = new Date()) {
  const start = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return {
    name: `${start}-${start + 1}`,
    startDate: new Date(Date.UTC(start, 9, 1)),
    endDate: new Date(Date.UTC(start + 1, 5, 30)),
  };
}
