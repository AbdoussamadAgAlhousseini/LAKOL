import "server-only";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { NotFoundError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac/policies";
import { getSchoolContext, SchoolNotFoundError, UnauthenticatedError, type SchoolContext } from "@/server/context";

/**
 * Contexte d'école pour une page : redirige vers la connexion si besoin,
 * 404 si l'école n'existe pas, null si l'utilisateur n'y a aucun rôle.
 */
export async function loadSchoolPage(slug: string, locale: string): Promise<SchoolContext | null> {
  try {
    return await getSchoolContext(slug);
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect({ href: "/login", locale });
    if (error instanceof SchoolNotFoundError) notFound();
    throw error;
  }
}

/** Contexte d'une page soumise à une condition d'accès (null : afficher « Accès refusé »). */
export async function loadGuardedPage(
  slug: string,
  locale: string,
  allowed: (ctx: SchoolContext) => boolean,
): Promise<SchoolContext | null> {
  const ctx = await loadSchoolPage(slug, locale);
  return ctx && allowed(ctx) ? ctx : null;
}

/**
 * Exécute une lecture de page : « introuvable » -> 404, accès refusé -> null
 * (la page affiche alors « Accès refusé »).
 */
export async function loadOrDeny<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
}
