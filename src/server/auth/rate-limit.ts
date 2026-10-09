import { prisma } from "@/server/db/client";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IDENTIFIER = 5;
const MAX_FAILURES_PER_IP = 30;

/** Vrai si trop d'échecs récents pour cet identifiant ou cette adresse IP. */
export async function isLoginBlocked(identifier: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [byIdentifier, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { identifier, success: false, createdAt: { gte: since } } }),
    ip ? prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }) : 0,
  ]);
  return byIdentifier >= MAX_FAILURES_PER_IDENTIFIER || byIp >= MAX_FAILURES_PER_IP;
}

export async function recordLoginAttempt(identifier: string, ip: string | null, success: boolean) {
  await prisma.loginAttempt.create({ data: { identifier, ip, success } });
  if (success) {
    // Une connexion réussie remet le compteur de l'identifiant à zéro.
    await prisma.loginAttempt.deleteMany({ where: { identifier, success: false } });
  }
}
