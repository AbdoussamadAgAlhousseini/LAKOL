// Initialisation d'une plateforme (production, seed, mises à jour) : catalogue
// des permissions, formules par défaut, compte super admin. Idempotent.
// Pas de "server-only" : utilisé par des scripts en ligne de commande.
import type { ModuleKey, PrismaClient } from "@prisma/client";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/server/rbac/permissions";
import { MODULE_KEYS } from "@/lib/modules";

export const DEFAULT_PLANS: {
  code: string;
  name: string;
  maxStudents: number | null;
  whatsappQuota: number;
  pricePerStudent: number;
  modules: ModuleKey[];
}[] = [
  {
    code: "FREE",
    name: "Essai",
    maxStudents: 50,
    whatsappQuota: 200,
    pricePerStudent: 0,
    modules: ["HOMEWORK", "ATTENDANCE", "GRADES"],
  },
  {
    code: "STANDARD",
    name: "Standard",
    maxStudents: 800,
    whatsappQuota: 3000,
    pricePerStudent: 2500,
    modules: ["HOMEWORK", "ATTENDANCE", "GRADES", "FINANCE", "MESSAGING", "TIMETABLE", "RESOURCES"],
  },
  {
    code: "PREMIUM",
    name: "Premium",
    maxStudents: null,
    whatsappQuota: 20000,
    pricePerStudent: 4000,
    modules: [...MODULE_KEYS],
  },
];

/**
 * Catalogue des permissions à jour, et permissions par défaut ajoutées aux
 * rôles système (sans retirer ce qu'une école a personnalisé).
 */
export async function syncPermissions(prisma: PrismaClient) {
  for (const [key, p] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: p.module, description: p.description },
      update: { module: p.module, description: p.description },
    });
  }
  let added = 0;
  const roles = await prisma.role.findMany({
    where: { isSystem: true, key: { in: [...SYSTEM_ROLES] } },
    include: { permissions: true },
  });
  for (const role of roles) {
    const have = new Set(role.permissions.map((p) => p.permissionKey));
    const missing = DEFAULT_ROLE_PERMISSIONS[role.key as (typeof SYSTEM_ROLES)[number]].filter((p) => !have.has(p));
    if (missing.length === 0) continue;
    await prisma.rolePermission.createMany({
      data: missing.map((permissionKey) => ({ schoolId: role.schoolId, roleId: role.id, permissionKey })),
      skipDuplicates: true,
    });
    added += missing.length;
  }
  return { catalog: Object.keys(PERMISSIONS).length, added };
}

/** Crée les formules manquantes ; ne modifie jamais une formule existante (prix réglés par le super admin). */
export async function ensurePlans(prisma: PrismaClient) {
  let created = 0;
  for (const plan of DEFAULT_PLANS) {
    if (await prisma.plan.findUnique({ where: { code: plan.code } })) continue;
    await prisma.plan.create({ data: plan });
    created++;
  }
  return { created };
}

/** Crée le compte super admin s'il n'existe pas (ou donne ce droit au compte existant de cet email). */
export async function ensureSuperAdmin(
  prisma: PrismaClient,
  input: { email: string; firstName: string; lastName: string; passwordHash: string },
) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    if (!existing.isPlatformAdmin)
      await prisma.user.update({ where: { id: existing.id }, data: { isPlatformAdmin: true } });
    return { created: false, email };
  }
  await prisma.user.create({
    data: {
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      isPlatformAdmin: true,
      passwordHash: input.passwordHash,
    },
  });
  return { created: true, email };
}
