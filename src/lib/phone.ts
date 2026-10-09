/** Indicatifs des pays visés en priorité ; le Mali (+223) par défaut. */
const COUNTRY_CODES: Record<string, string> = {
  ML: "223",
  SN: "221",
  CI: "225",
  BF: "226",
  NE: "227",
  GN: "224",
};

/**
 * Normalise un numéro au format E.164 (+22370000000).
 * Accepte espaces, tirets, points, préfixe 00 ou +. Un numéro local de
 * 8 chiffres reçoit l'indicatif du pays donné. Retourne null si invalide.
 */
export function normalizePhone(input: string, country = "ML"): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else {
    const code = COUNTRY_CODES[country];
    if (!code || !/^\d{8,10}$/.test(digits)) return null;
    digits = code + digits;
  }
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `+${digits}`;
}

export type Identifier = { kind: "email"; value: string } | { kind: "phone"; value: string };

/** Interprète la saisie de connexion : email ou numéro de téléphone. */
export function parseIdentifier(input: string, country = "ML"): Identifier | null {
  const value = input.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: "email", value: email } : null;
  }
  const phone = normalizePhone(value, country);
  return phone ? { kind: "phone", value: phone } : null;
}
