"use server";

import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { prisma } from "@/server/db/client";
import { parseIdentifier } from "@/lib/phone";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { isLoginBlocked, recordLoginAttempt } from "@/server/auth/rate-limit";
import { requestMeta } from "@/server/auth/request";
import {
  clearSessionCookie,
  createSession,
  getCurrentSession,
  invalidateSession,
  invalidateUserSessions,
  setSessionCookie,
} from "@/server/auth/session";
import { consumeVerificationCode, sendVerificationCode } from "@/server/auth/verification";

export type FormState = { error?: string; success?: string; step?: "code"; identifier?: string } | undefined;

// Empreinte factice : on vérifie un mot de passe même si le compte n'existe
// pas, pour ne pas révéler son existence par le temps de réponse.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$V32DL3IrLl6K7AKXeU0l8Q$Z29+qhHz/MA4YwUfwGmHWYKSXCE+J+s7S6tSnRbK44E";

const loginSchema = z.object({
  locale: z.string(),
  identifier: z.string().min(3).max(120),
  password: z.string().min(1).max(200),
});

async function findUserByIdentifier(raw: string) {
  const identifier = parseIdentifier(raw);
  if (!identifier) return { identifier: null, user: null };
  const user = await prisma.user.findFirst({
    where: { [identifier.kind]: identifier.value, deletedAt: null, isActive: true },
  });
  return { identifier, user };
}

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalidInput" };
  const { locale, password } = parsed.data;
  const { ip, userAgent } = await requestMeta();

  const { identifier, user } = await findUserByIdentifier(parsed.data.identifier);
  if (!identifier) return { error: "invalidCredentials" };
  if (await isLoginBlocked(identifier.value, ip)) return { error: "tooManyAttempts" };

  const valid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
  await recordLoginAttempt(identifier.value, ip, Boolean(user && valid));
  if (!user || !valid) return { error: "invalidCredentials" };

  const { token, session } = await createSession(user.id, { ip, userAgent });
  await setSessionCookie(token, session.expiresAt);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  redirect({ href: "/spaces", locale });
}

export async function logoutAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "fr");
  const current = await getCurrentSession();
  if (current) await invalidateSession(current.session.id);
  await clearSessionCookie();
  redirect({ href: "/login", locale });
}

const resetRequestSchema = z.object({ identifier: z.string().min(3).max(120) });
const resetSchema = z.object({
  locale: z.string(),
  identifier: z.string().min(3).max(120),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(200),
});

export async function resetPasswordAction(state: FormState, formData: FormData): Promise<FormState> {
  const data = Object.fromEntries(formData);

  // Étape 1 : envoi du code. Réponse identique que le compte existe ou non.
  if (data.step !== "code") {
    const parsed = resetRequestSchema.safeParse(data);
    if (!parsed.success) return { error: "invalidInput" };
    const { identifier, user } = await findUserByIdentifier(parsed.data.identifier);
    if (!identifier) return { error: "invalidInput" };
    const { ip } = await requestMeta();
    if (await isLoginBlocked(identifier.value, ip)) return { error: "tooManyAttempts" };
    if (user) await sendVerificationCode(user, "PASSWORD_RESET");
    return { step: "code", identifier: parsed.data.identifier, success: "codeSent" };
  }

  // Étape 2 : code + nouveau mot de passe.
  const parsed = resetSchema.safeParse(data);
  if (!parsed.success) return { ...state, step: "code", error: "invalidInput" };
  const { user } = await findUserByIdentifier(parsed.data.identifier);
  const ok = user ? await consumeVerificationCode(user.id, "PASSWORD_RESET", parsed.data.code) : false;
  if (!user || !ok) return { step: "code", identifier: parsed.data.identifier, error: "invalidCode" };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.password), mustChangePwd: false },
  });
  await invalidateUserSessions(user.id);
  redirect({ href: "/login?reset=1", locale: parsed.data.locale });
}

const changePasswordSchema = z.object({
  locale: z.string(),
  current: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  confirm: z.string().min(1).max(200),
});

/** Changement de mot de passe (obligatoire après un mot de passe provisoire). */
export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "passwordTooShort" };
  const { locale, current, password, confirm } = parsed.data;
  if (password !== confirm) return { error: "passwordMismatch" };

  const session = await getCurrentSession();
  if (!session) redirect({ href: "/login", locale });
  const user = session!.user;
  if (!(await verifyPassword(user.passwordHash ?? DUMMY_HASH, current))) return { error: "wrongCurrentPassword" };
  if (current === password) return { error: "passwordUnchanged" };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePwd: false },
  });
  // Les autres sessions (ex. un appareil partagé) sont fermées.
  await prisma.session.deleteMany({ where: { userId: user.id, id: { not: session!.session.id } } });
  redirect({ href: "/spaces", locale });
}
