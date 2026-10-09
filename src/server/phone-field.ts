import { normalizePhone } from "@/lib/phone";
import { DomainError } from "@/server/errors";

/** Normalise un numéro selon le pays de l'école, ou lève une erreur sur le champ. */
export function phoneOrFail(raw: string, country: string, field: string): string {
  const phone = normalizePhone(raw, country);
  if (!phone) throw new DomainError("invalidPhone", field);
  return phone;
}

export function optionalPhone(raw: string | undefined, country: string, field: string): string | null {
  return raw ? phoneOrFail(raw, country, field) : null;
}
