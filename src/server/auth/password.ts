import { hash, verify } from "@node-rs/argon2";

// Paramètres argon2id recommandés par l'OWASP (19 MiB, 2 itérations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Mot de passe lisible pour un premier envoi par WhatsApp (sans caractères ambigus). */
export function generateTemporaryPassword(length = 8): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
