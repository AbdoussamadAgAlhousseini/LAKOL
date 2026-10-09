"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth/request";
import { DomainError } from "@/server/errors";
import { getPublicSchool, submitPreRegistration } from "@/server/platform/preregistration";
import { phoneOrFail } from "@/server/phone-field";
import { formDataToObject, type ActionResult } from "@/server/action";
import { email, id, optionalDate, optionalText, text } from "@/lib/zod";

const schema = z.object({
  levelId: id,
  firstName: text(80),
  lastName: text(80),
  gender: z.enum(["MALE", "FEMALE"]),
  birthDate: optionalDate,
  birthPlace: optionalText(120),
  previousSchool: optionalText(160),
  guardianFirstName: text(80),
  guardianLastName: text(80),
  guardianPhone: text(30),
  guardianEmail: email.optional(),
  guardianRelation: z.enum(["FATHER", "MOTHER", "LEGAL_GUARDIAN", "OTHER"]),
  notes: optionalText(1000),
  website: z.string().max(0).optional(), // piège à robots : champ caché qui doit rester vide
});

/** Formulaire public (sans compte) : pas de schoolAction, mais validation et limitation par IP. */
export async function preRegisterAction(slug: string, form: FormData): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(formDataToObject(form));
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), "invalid"])),
    };
  }
  try {
    const school = await getPublicSchool(slug);
    if (!school) return { ok: false, error: "domain", code: "notFound" };
    const { website, ...input } = parsed.data;
    void website;
    const { ip } = await requestMeta();
    await submitPreRegistration(
      slug,
      { ...input, guardianPhone: phoneOrFail(input.guardianPhone, school.school.country, "guardianPhone") },
      ip,
    );
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof DomainError) {
      return {
        ok: false,
        error: "domain",
        code: error.code,
        fields: error.field ? { [error.field]: error.code } : undefined,
      };
    }
    return { ok: false, error: "server" };
  }
}
