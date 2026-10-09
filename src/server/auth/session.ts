import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Session, User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { generateToken, sha256 } from "./tokens";

export const SESSION_COOKIE = "lakol_session";
const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 30 * DAY;
const REFRESH_THRESHOLD = 15 * DAY;

export type SessionWithUser = { session: Session; user: User };

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; session: Session }> {
  const token = generateToken();
  const session = await prisma.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
    },
  });
  return { token, session };
}

/** Valide un jeton ; prolonge la session si elle approche de l'expiration. */
export async function validateSessionToken(token: string): Promise<SessionWithUser | null> {
  const id = sha256(token);
  const row = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!row) return null;
  const { user, ...session } = row;
  if (session.expiresAt.getTime() <= Date.now() || !user.isActive || user.deletedAt) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  if (session.expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL);
    await prisma.session.update({ where: { id }, data: { expiresAt: session.expiresAt } });
  }
  return { session, user };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Session de la requête courante (mémorisée pour la durée du rendu). */
export const getCurrentSession = cache(async (): Promise<SessionWithUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});
