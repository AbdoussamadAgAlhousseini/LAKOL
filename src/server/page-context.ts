import "server-only";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
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
