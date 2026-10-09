// Les notes sont des entiers en centièmes : 13,75 -> 1375.

export function toCenti(value: number): number {
  return Math.round(value * 100);
}

export function formatScore(centi: number | null | undefined, locale = "fr"): string {
  if (centi === null || centi === undefined) return "—";
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centi / 100);
}

/** Ramène une note d'un barème à un autre (ex. 7/10 -> 14/20), en centièmes. */
export function rescale(centi: number, from: number, to: number): number {
  return Math.round((centi * to) / from);
}
