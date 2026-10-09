// Les montants sont des entiers en unités mineures de la devise.
// Le XOF n'a pas de subdivision : 1 = 1 FCFA.

const MINOR_DIGITS: Record<string, number> = { XOF: 0, XAF: 0, GNF: 0, EUR: 2, USD: 2 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

export function formatMoney(amount: number, currency = "XOF", locale = "fr"): string {
  if (!Number.isInteger(amount)) throw new Error("Montant non entier");
  const digits = minorDigits(currency);
  const value = amount / 10 ** digits;
  if (currency === "XOF" || currency === "XAF") {
    // Format usuel : « 25 000 FCFA »
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
    return `${n} FCFA`;
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits }).format(value);
}

/** Pourcentage en points de base (1000 = 10 %), arrondi à l'unité mineure. */
export function applyBasisPoints(amount: number, basisPoints: number): number {
  return Math.round((amount * basisPoints) / 10_000);
}

export function sum(amounts: number[]): number {
  return amounts.reduce((total, a) => total + a, 0);
}

/** Pourcentage déjà calculé (ex. 31.3) -> « 31,3 % » selon la langue. */
export function formatPercent(value: number | null, locale = "fr"): string {
  if (value === null) return "—";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} %`;
}
