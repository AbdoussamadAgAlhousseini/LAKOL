/* Synchronise le catalogue des permissions avec la base (après une mise à jour) :
 * - crée les permissions nouvelles ;
 * - ajoute aux rôles système les permissions par défaut manquantes
 *   (sans jamais retirer ce qu'une école a personnalisé).
 * Lancement : pnpm db:sync-permissions */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "../src/server/rbac/permissions";

const prisma = new PrismaClient();

async function main() {
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
  console.log(
    `Permissions synchronisées : ${Object.keys(PERMISSIONS).length} au catalogue, ${added} ajoutées aux rôles.`,
  );
}

main().finally(() => prisma.$disconnect());
