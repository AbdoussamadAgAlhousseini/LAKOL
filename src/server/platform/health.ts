import "server-only";
import { Redis } from "ioredis";
import { prisma } from "@/server/db/client";
import { redisConnection } from "@/server/jobs/queue";
import { schoolFromHost } from "@/lib/subdomain";

async function timed<T>(check: () => Promise<T>, timeoutMs = 2000) {
  return Promise.race([
    check().then(() => "ok" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]).catch(() => "error" as const);
}

/** État des dépendances : base (indispensable) et Redis (file des tâches). */
export async function healthStatus() {
  const db = await timed(() => prisma.$queryRaw`SELECT 1`);
  let redis: "ok" | "timeout" | "error" | "disabled" = "disabled";
  if (process.env.REDIS_URL) {
    const client = new Redis({
      ...redisConnection(),
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 0,
    });
    redis = await timed(async () => {
      await client.connect();
      await client.ping();
    });
    client.disconnect();
  }
  return { ok: db === "ok", db, redis };
}

/** Domaine autorisé à recevoir un certificat : principal, www, ou sous-domaine d'une école existante. */
export async function isServedDomain(domain: string, root: string | undefined) {
  if (!root) return false;
  const d = domain.toLowerCase();
  const r = root.toLowerCase();
  if (d === r || d === `www.${r}`) return true;
  const slug = schoolFromHost(d, r);
  if (!slug) return false;
  return Boolean(await prisma.school.findFirst({ where: { slug, deletedAt: null }, select: { id: true } }));
}
