// Nombres en toutes lettres (français, orthographe traditionnelle),
// pour les reçus : « vingt-cinq mille francs CFA ».

const UNITS = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
  "dix-sept",
  "dix-huit",
  "dix-neuf",
];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

function below100(n: number): string {
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? TENS[t] : u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${UNITS[n - 60]}`;
  // 80-99
  const r = n - 80;
  return r === 0 ? "quatre-vingts" : `quatre-vingt-${UNITS[r]}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return below100(r);
  const hundreds = h === 1 ? "cent" : `${UNITS[h]} cent${r === 0 ? "s" : ""}`;
  return r === 0 ? hundreds : `${hundreds} ${below100(r)}`;
}

export function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0) throw new Error("Entier positif attendu");
  if (value === 0) return "zéro";
  const parts: string[] = [];
  const scales: [number, string, string][] = [
    [1_000_000_000, "milliard", "milliards"],
    [1_000_000, "million", "millions"],
  ];
  let rest = value;
  for (const [size, one, many] of scales) {
    const q = Math.floor(rest / size);
    if (q > 0) {
      parts.push(`${below1000(q)} ${q > 1 ? many : one}`);
      rest %= size;
    }
  }
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    // « mille » est invariable ; « quatre-vingts » et « cents » perdent leur s devant mille.
    const words = thousands === 1 ? "" : below1000(thousands).replace(/(cent|vingt)s$/, "$1");
    parts.push(words ? `${words} mille` : "mille");
    rest %= 1000;
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

/** Montant en toutes lettres avec la devise (XOF -> « francs CFA »). */
export function amountInWords(amount: number, currency = "XOF"): string {
  const names: Record<string, string> = {
    XOF: "francs CFA",
    XAF: "francs CFA",
    GNF: "francs guinéens",
    EUR: "euros",
    USD: "dollars",
  };
  return `${numberToWords(amount)} ${names[currency] ?? currency}`;
}
