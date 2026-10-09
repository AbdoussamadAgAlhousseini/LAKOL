import "server-only";
import { z } from "zod";
import { getSchoolContext, UnauthenticatedError, type SchoolContext } from "@/server/context";
import { ForbiddenError, requirePermission } from "@/server/rbac/policies";
import { TenantViolationError } from "@/server/db/tenant";
import { logger } from "@/server/logger";
import { requestMeta } from "@/server/auth/request";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_only" | "invalid" | "server"; issues?: z.ZodIssue[] };

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

      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: "invalid", issues: parsed.error.issues };

      const { ip } = await requestMeta();
      return { ok: true, data: await handler({ ...ctx, ip }, parsed.data) };
    } catch (error) {
      if (error instanceof UnauthenticatedError) return { ok: false, error: "unauthenticated" };
      if (error instanceof ForbiddenError || error instanceof TenantViolationError) {
        logger.warn({ schoolSlug, error: error.message }, "action refusée");
        return { ok: false, error: "forbidden" };
      }
      logger.error({ schoolSlug, error: String(error) }, "action en échec");
      return { ok: false, error: "server" };
    }
  };
}
