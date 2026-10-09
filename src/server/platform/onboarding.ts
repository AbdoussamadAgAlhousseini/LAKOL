import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool } from "@/server/db/tenant";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_NAMES, SYSTEM_ROLES } from "@/server/rbac/permissions";
import { sendAccess } from "@/server/services/accounts";
import { addDays } from "@/lib/time";
import { TRIAL_DAYS } from "./subscriptions";

/** Adresses réservées : chemins de l'application et sous-domaines techniques. */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "www",
  "mail",
  "login",
  "logout",
  "inscription",
  "creer-mon-ecole",
  "spaces",
  "account",
  "fr",
  "en",
  "static",
  "lakol",
  "support",
]);

/** « Complexe Scolaire Les Étoiles » -> « complexe-scolaire-les-etoiles ». */
export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Adresse libre à partir d'une proposition (ajoute -2, -3… si nécessaire). */
export async function availableSlug(wanted: string) {
  const base = isValidSlug(wanted) ? wanted : slugify(wanted) || "ecole";
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    if (!isValidSlug(candidate)) continue;
    if (!(await prisma.school.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  throw new DomainError("slugTaken", "slug");
}

export interface NewSchoolInput {
  name: string;
  slug?: string | null;
  city?: string | null;
  country?: string;
  phone?: string | null;
  email?: string | null;
  planCode: string;
  /** Essai de 30 jours (inscription en ligne) ou abonnement actif (créé par la plateforme). */
  trial: boolean;
  director: {
    firstName: string;
    lastName: string;
    phone?: string | null;
    email?: string | null;
    /** Mot de passe choisi (inscription en ligne). Sinon : mot de passe provisoire envoyé. */
    password?: string | null;
  };
}

/**
 * Crée une école prête à l'emploi : rôles système et permissions, site
 * principal, abonnement, compte du directeur. Un compte existant (même
 * téléphone ou email) est réutilisé seulement si `allowExistingAccount`.
 */
export async function createSchool(
  input: NewSchoolInput,
  options: { actorId: string | null; allowExistingAccount: boolean },
) {
  const { director } = input;
  if (!director.phone && !director.email) throw new DomainError("contactRequired", "directorPhone");
  const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
  if (!plan || !plan.isActive) throw new DomainError("notFound", "planCode");

  if (input.slug) {
    if (!isValidSlug(input.slug)) throw new DomainError("invalidSlug", "slug");
    if (await prisma.school.findUnique({ where: { slug: input.slug } })) throw new DomainError("slugTaken", "slug");
  }
  const slug = input.slug ?? (await availableSlug(input.name));

  const existing = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [
        ...(director.phone ? [{ phone: director.phone }] : []),
        ...(director.email ? [{ email: director.email }] : []),
      ],
    },
  });
  if (existing && !options.allowExistingAccount) throw new DomainError("accountExists", "directorPhone");
  const tempPassword = existing || director.password ? null : generateTemporaryPassword();
  const passwordHash = director.password
    ? await hashPassword(director.password)
    : tempPassword
      ? await hashPassword(tempPassword)
      : null;

  const now = new Date();
  const { school, user } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const school = await tx.school.create({
      data: {
        name: input.name,
        slug,
        city: input.city ?? null,
        country: input.country ?? "ML",
        phone: input.phone ?? null,
        email: input.email ?? null,
      },
    });
    await tx.subscription.create({
      data: {
        schoolId: school.id,
        planId: plan.id,
        status: input.trial ? "TRIAL" : "ACTIVE",
        trialEndsAt: input.trial ? addDays(now, TRIAL_DAYS) : null,
        currentPeriodStart: input.trial ? null : now,
      },
    });
    await tx.campus.create({ data: { schoolId: school.id, name: "Site principal", isMain: true } });
    let directorRoleId = "";
    for (const key of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: { schoolId: school.id, key, name: ROLE_NAMES[key], isSystem: true },
      });
      if (key === "DIRECTOR") directorRoleId = role.id;
      await tx.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[key].map((permissionKey) => ({
          schoolId: school.id,
          roleId: role.id,
          permissionKey,
        })),
      });
    }
    const user =
      existing ??
      (await tx.user.create({
        data: {
          firstName: director.firstName,
          lastName: director.lastName,
          phone: director.phone ?? null,
          email: director.email ?? null,
          passwordHash,
          mustChangePwd: Boolean(tempPassword),
        },
      }));
    await tx.userRole.create({ data: { schoolId: school.id, userId: user.id, roleId: directorRoleId } });
    return { school, user };
  });

  const db = forSchool(school.id);
  await audit(
    db,
    { schoolId: school.id, userId: options.actorId ?? user.id, ip: null },
    {
      action: "school.create",
      entityType: "School",
      entityId: school.id,
      after: { name: school.name, slug, plan: plan.code, trial: input.trial },
    },
  );
  // Accès envoyés par WhatsApp (ou email) quand l'école est créée par la plateforme.
  if (!director.password) {
    await sendAccess(
      { db, school, user, scope: { permissions: new Set(), classIds: new Set(), studentIds: new Set() } },
      user,
      "staff",
      tempPassword,
    );
  }
  return { school, user };
}

const SIGNUPS_PER_IP_PER_DAY = 3;

/** Inscription en ligne d'une école (essai) : limitée par adresse IP. */
export async function signUpSchool(input: Omit<NewSchoolInput, "planCode" | "trial">, ip: string | null) {
  if (ip) {
    const recent = await prisma.loginAttempt.count({
      where: { identifier: "school.signup", ip, createdAt: { gte: addDays(new Date(), -1) } },
    });
    if (recent >= SIGNUPS_PER_IP_PER_DAY) throw new DomainError("tooManyRequests");
  }
  const result = await createSchool(
    { ...input, planCode: "STANDARD", trial: true },
    { actorId: null, allowExistingAccount: false },
  );
  await prisma.loginAttempt.create({ data: { identifier: "school.signup", ip, success: true } });
  return result;
}
