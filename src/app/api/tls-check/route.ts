import { isServedDomain } from "@/server/platform/health";

export const dynamic = "force-dynamic";

/**
 * Appelé par Caddy (« on demand TLS ») avant d'émettre un certificat : seuls le
 * domaine principal et les sous-domaines d'écoles existantes sont acceptés.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain") ?? "";
  return (await isServedDomain(domain, process.env.ROOT_DOMAIN))
    ? new Response("ok")
    : new Response("unknown", { status: 404 });
}
