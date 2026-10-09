import { healthStatus } from "@/server/platform/health";

export const dynamic = "force-dynamic";

/** Sonde de santé (Docker, Caddy, surveillance externe). 503 si la base ne répond pas. */
export async function GET() {
  const status = await healthStatus();
  return Response.json(
    { status: status.ok ? "ok" : "degraded", db: status.db, redis: status.redis, time: new Date().toISOString() },
    { status: status.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
