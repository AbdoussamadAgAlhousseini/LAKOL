import { z } from "zod";

// Champs de formulaire : les valeurs vides sont retirées en amont
// (formDataToObject), donc « optionnel » = absent.

export const text = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 200) => z.string().trim().max(max).optional();
export const id = z.string().min(1).max(40);
export const optionalId = id.optional();
/** Case à cocher : « on » si cochée, absente sinon. */
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const int = (min = 0, max = 1_000_000_000) => z.coerce.number().int().min(min).max(max);
export const optionalInt = (min = 0, max = 1_000_000_000) => int(min, max).optional();
/** Date du champ <input type="date"> (AAAA-MM-JJ), en UTC minuit. */
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((v) => new Date(`${v}T00:00:00.000Z`));
export const optionalDate = date.optional();
export const email = z.string().trim().toLowerCase().email().max(120);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const file = z.instanceof(File);
