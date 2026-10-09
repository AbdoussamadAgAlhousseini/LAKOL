import "server-only";
import type { User } from "@prisma/client";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { actor, type ServiceContext } from "./context";
import { notifyUser } from "./notify";

export interface ContactInput {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
}

/**
 * Retrouve le compte d'une personne (téléphone, email ou identifiant) ou le
 * crée avec un mot de passe provisoire à changer à la première connexion.
 * Un parent déjà inscrit dans une autre école garde son compte.
 */
export async function ensureUser(ctx: ServiceContext, input: ContactInput) {
  const or = [
    input.phone ? { phone: input.phone } : null,
    input.email ? { email: input.email } : null,
    input.username ? { username: input.username } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  if (or.length === 0) throw new DomainError("contactRequired");

  const matches = await ctx.db.user.findMany({ where: { OR: or, deletedAt: null } });
  if (matches.length > 1) throw new DomainError("contactConflict");
  if (matches[0]) return { user: matches[0], created: false as const, tempPassword: null };

  const tempPassword = generateTemporaryPassword();
  const user = await ctx.db.user.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      username: input.username ?? null,
      locale: ctx.school.defaultLocale,
      passwordHash: await hashPassword(tempPassword),
      mustChangePwd: true,
    },
  });
  return { user, created: true as const, tempPassword };
}

export async function grantRole(ctx: ServiceContext, userId: string, roleKey: string) {
  const role = await ctx.db.role.findFirst({ where: { key: roleKey } });
  if (!role) throw new DomainError("unknownRole");
  const existing = await ctx.db.userRole.findFirst({ where: { userId, roleId: role.id } });
  if (existing) return;
  await ctx.db.userRole.create({ data: { schoolId: ctx.school.id, userId, roleId: role.id } });
  await audit(ctx.db, actor(ctx), {
    action: "role.grant",
    entityType: "User",
    entityId: userId,
    after: { role: roleKey },
  });
}

export async function revokeRole(ctx: ServiceContext, userId: string, roleKey: string) {
  const role = await ctx.db.role.findFirst({ where: { key: roleKey } });
  if (!role) return;
  const res = await ctx.db.userRole.deleteMany({ where: { userId, roleId: role.id } });
  if (res.count > 0) {
    await audit(ctx.db, actor(ctx), {
      action: "role.revoke",
      entityType: "User",
      entityId: userId,
      before: { role: roleKey },
    });
  }
}

/** Remplace le mot de passe par un mot de passe provisoire (renvoi des accès). */
export async function resetToTemporaryPassword(ctx: ServiceContext, userId: string) {
  const tempPassword = generateTemporaryPassword();
  await ctx.db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(tempPassword), mustChangePwd: true },
  });
  await ctx.db.session.deleteMany({ where: { userId } });
  return tempPassword;
}

function loginUrl(locale: string) {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/${locale}/login`;
}

const TEMPLATES = {
  fr: {
    newTitle: (school: string) => `Bienvenue sur LAKOL — ${school}`,
    newBody: (name: string, school: string, id: string, pwd: string, url: string, forWhom: string) =>
      `Bonjour ${name}, votre compte ${forWhom} pour ${school} est prêt.\nIdentifiant : ${id}\nMot de passe provisoire : ${pwd}\nConnexion : ${url}\nVous choisirez un nouveau mot de passe à la première connexion.`,
    accessTitle: (school: string) => `Nouvel accès — ${school}`,
    accessBody: (name: string, school: string, url: string, forWhom: string) =>
      `Bonjour ${name}, ${school} vous a donné accès à l'espace ${forWhom} avec votre compte LAKOL habituel.\nConnexion : ${url}`,
    roles: { parent: "parent", staff: "personnel", student: "élève" },
  },
  en: {
    newTitle: (school: string) => `Welcome to LAKOL — ${school}`,
    newBody: (name: string, school: string, id: string, pwd: string, url: string, forWhom: string) =>
      `Hello ${name}, your ${forWhom} account for ${school} is ready.\nLogin: ${id}\nTemporary password: ${pwd}\nSign in: ${url}\nYou will choose a new password when you first sign in.`,
    accessTitle: (school: string) => `New access — ${school}`,
    accessBody: (name: string, school: string, url: string, forWhom: string) =>
      `Hello ${name}, ${school} gave you access to the ${forWhom} space with your existing LAKOL account.\nSign in: ${url}`,
    roles: { parent: "parent", staff: "staff", student: "student" },
  },
};

/**
 * Envoie les accès : identifiant + mot de passe provisoire pour un nouveau
 * compte, simple information pour un compte existant. `recipient` permet
 * d'envoyer les accès d'un élève à son parent.
 */
export async function sendAccess(
  ctx: ServiceContext,
  account: Pick<User, "id" | "firstName" | "phone" | "email" | "username" | "locale">,
  kind: "parent" | "staff" | "student",
  tempPassword: string | null,
  recipient: Pick<User, "id" | "phone" | "email"> = account,
) {
  const t = account.locale === "en" ? TEMPLATES.en : TEMPLATES.fr;
  const url = loginUrl(account.locale);
  const school = ctx.school.name;
  const identifier = account.phone ?? account.email ?? account.username ?? "";
  const message = tempPassword
    ? {
        type: "account.created",
        title: t.newTitle(school),
        body: t.newBody(account.firstName, school, identifier, tempPassword, url, t.roles[kind]),
      }
    : {
        type: "account.access",
        title: t.accessTitle(school),
        body: t.accessBody(account.firstName, school, url, t.roles[kind]),
      };
  // Demandé par l'école à l'instant : envoyé même pendant les heures calmes.
  return notifyUser(ctx, recipient, { ...message, urgent: true });
}
