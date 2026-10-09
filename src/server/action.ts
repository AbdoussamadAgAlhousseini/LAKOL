import "server-only";
import { z } from "zod";
import { getSchoolContext, UnauthenticatedError, type SchoolContext } from "@/server/context";
import { ForbiddenError, requirePermission } from "@/server/rbac/policies";
import { TenantViolationError } from "@/server/db/tenant";
import { DomainError } from "@/server/errors";
import { logger } from "@/server/logger";
import { requestMeta } from "@/server/auth/request";

export type ActionError = "unauthenticated" | "forbidden" | "read_only" | "invalid" | "domain" | "server";

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ActionError; code?: string; fields?: Record<string, string> };

type Permission = Parameters<typeof requirePermission>[1];

interface ActionOptions<S extends z.ZodTypeAny> {
  schema: S;
  /** Permission minimale (école ou `:own`). Le périmètre fin se vérifie dans le handler. */
  permission?: Permission;
  /** Autorisé même si l'abonnement est suspendu (lecture). */
  allowReadOnly?: boolean;
}

export interface ActionContext extends SchoolContext {
  ip: string | null;
}

/**
 * Convertit un FormData en objet : champs répétés -> tableaux, champs vides
 * -> absents (les schémas Zod traitent ainsi "non renseigné" uniformément).
 */
export function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (value instanceof File && value.size === 0) continue;
    const v = typeof value === "string" ? value.trim() : value;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      out[k] = [...((out[k] as unknown[]) ?? []), v];
    } else out[key] = v;
  }
  return out;
}

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.code === "invalid_type" && issue.received === "undefined" ? "required" : "invalid";
  }
  return fields;
}

/**
 * Point d'entrée unique des actions d'une école : authentification, résolution
 * de l'école, validation Zod, permission et mode lecture seule.
 * Les Server Actions de Next.js vérifient déjà l'origine (protection CSRF).
 */
export function schoolAction<S extends z.ZodTypeAny, R>(
  options: ActionOptions<S>,
  handler: (ctx: ActionContext, input: z.infer<S>) => Promise<R>,
) {
  return async (schoolSlug: string, raw: unknown): Promise<ActionResult<R>> => {
    try {
      const ctx = await getSchoolContext(schoolSlug);
      if (!ctx) return { ok: false, error: "forbidden" };
      if (ctx.readOnly && !options.allowReadOnly) return { ok: false, error: "read_only" };
      if (options.permission) requirePermission(ctx.scope, options.permission);

      const input = raw instanceof FormData ? formDataToObject(raw) : raw;
      const parsed = options.schema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid", fields: fieldErrors(parsed.error.issues) };

      const { ip } = await requestMeta();
      return { ok: true, data: await handler({ ...ctx, ip }, parsed.data) };
    } catch (error) {
      if (error instanceof UnauthenticatedError) return { ok: false, error: "unauthenticated" };
      if (error instanceof ForbiddenError || error instanceof TenantViolationError) {
        logger.warn({ schoolSlug, error: error.message }, "action refusée");
        return { ok: false, error: "forbidden" };
      }
      if (error instanceof DomainError) {
        return {
          ok: false,
          error: "domain",
          code: error.code,
          fields: error.field ? { [error.field]: error.code } : undefined,
        };
      }
      logger.error({ schoolSlug, error: String(error), stack: (error as Error)?.stack }, "action en échec");
      return { ok: false, error: "server" };
    }
  };
}
