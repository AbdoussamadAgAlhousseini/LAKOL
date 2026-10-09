"use server";

import { z } from "zod";
import { publicAction } from "@/server/platform-action";
import { signUpSchool } from "@/server/platform/onboarding";
import { requestMeta } from "@/server/auth/request";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { phoneOrFail } from "@/server/phone-field";
import { email, text } from "@/lib/zod";

export const signUpAction = publicAction(
  z.object({
    schoolName: text(160),
    city: text(80),
    firstName: text(80),
    lastName: text(80),
    phone: text(30),
    email: email.optional(),
    password: z.string().min(8).max(200),
    confirm: z.string().min(8).max(200),
    accept: z.literal("on"),
  }),
  async (input, { ip }) => {
    if (input.password !== input.confirm) throw new DomainError("passwordMismatch", "confirm");
    const phone = phoneOrFail(input.phone, "ML", "phone");
    let created;
    try {
      created = await signUpSchool(
        {
          name: input.schoolName,
          city: input.city,
          phone,
          email: input.email ?? null,
          director: {
            firstName: input.firstName,
            lastName: input.lastName,
            phone,
            email: input.email ?? null,
            password: input.password,
          },
        },
        ip,
      );
    } catch (error) {
      // Le téléphone du directeur est déjà un compte : on l'indique sur le bon champ.
      if (error instanceof DomainError && error.code === "accountExists")
        throw new DomainError("accountExists", "phone");
      throw error;
    }
    const { school, user } = created;
    const { userAgent } = await requestMeta();
    const { token, session } = await createSession(user.id, { ip, userAgent });
    await setSessionCookie(token, session.expiresAt);
    return { id: school.slug };
  },
);
