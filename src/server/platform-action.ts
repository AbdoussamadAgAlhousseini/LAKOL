import "server-only";
import type { User } from "@prisma/client";
import type { z } from "zod";
import { getCurrentSession } from "@/server/auth/session";
import { requestMeta } from "@/server/auth/request";
import { DomainError } from "@/server/errors";
import { logger } from "@/server/logger";
import { ForbiddenError } from "@/server/rbac/policies";
import { fieldErrors, formDataToObject, type ActionResult } from "./action";

// Actions hors d'une école : espace super admin et formulaires publics. Même
// signature que `schoolAction` (le premier argument est ignoré) pour réutiliser
// les composants de formulaire.

async function run<S extends z.ZodTypeAny, R>(
  schema: S,
  raw: unknown,
  handler: (input: z.infer<S>, meta: { ip: string | null }) => Promise<R>,
): Promise<ActionResult<R>> {
  try {
    const parsed = schema.safeParse(raw instanceof FormData ? formDataToObject(raw) : raw);
    if (!parsed.success) return { ok: false, error: "invalid", fields: fieldErrors(parsed.error.issues) };
    const { ip } = await requestMeta();
    return { ok: true, data: await handler(parsed.data, { ip }) };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "forbidden" };
    if (error instanceof DomainError) {
      return {
        ok: false,
        error: "domain",
        code: error.code,
        fields: error.field ? { [error.field]: error.code } : undefined,
      };
    }
    // redirect() de Next.js passe par une exception : on la laisse remonter.
    if ((error as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw error;
    logger.error({ error: String(error), stack: (error as Error)?.stack }, "action plateforme en échec");
    return { ok: false, error: "server" };
  }
}

/** Action réservée au super admin de la plateforme. */
export function platformAction<S extends z.ZodTypeAny, R>(
  schema: S,
  handler: (admin: User, input: z.infer<S>) => Promise<R>,
) {
  return async (_scope: string, raw: unknown): Promise<ActionResult<R>> => {
    const current = await getCurrentSession();
    if (!current) return { ok: false, error: "unauthenticated" };
    if (!current.user.isPlatformAdmin) return { ok: false, error: "forbidden" };
    return run(schema, raw, (input) => handler(current.user, input));
  };
}

/** Formulaire public (sans compte), ex. inscription d'une école. */
export function publicAction<S extends z.ZodTypeAny, R>(
  schema: S,
  handler: (input: z.infer<S>, meta: { ip: string | null }) => Promise<R>,
) {
  return async (_scope: string, raw: unknown): Promise<ActionResult<R>> => run(schema, raw, handler);
}
