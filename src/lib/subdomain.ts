// Accès par sous-domaine : `les-etoiles.lakol.ml` mène à l'espace de l'école.

/** Sous-domaines techniques qui ne désignent pas une école. */
const NOT_SCHOOLS = new Set(["www", "app", "admin", "api", "mail", "static"]);

/**
 * École désignée par l'hôte, ou null (domaine principal, autre domaine, IP…).
 * `rootDomain` sans port ni point initial (ex. « lakol.ml »).
 */
export function schoolFromHost(host: string | null | undefined, rootDomain: string | undefined): string | null {
  if (!host || !rootDomain) return null;
  const hostname = host.split(":")[0].toLowerCase();
  const root = rootDomain.toLowerCase().replace(/^\./, "");
  if (!hostname.endsWith(`.${root}`)) return null;
  const sub = hostname.slice(0, -root.length - 1);
  if (!sub || sub.includes(".") || NOT_SCHOOLS.has(sub)) return null;
  return /^[a-z0-9-]{2,40}$/.test(sub) ? sub : null;
}
