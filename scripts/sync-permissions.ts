/* Synchronise le catalogue des permissions avec la base (après une mise à jour).
 * Lancement : pnpm db:sync-permissions */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncPermissions } from "../src/server/platform/bootstrap";

const prisma = new PrismaClient();

syncPermissions(prisma)
  .then(({ catalog, added }) =>
    console.log(`Permissions synchronisées : ${catalog} au catalogue, ${added} ajoutées aux rôles.`),
  )
  .finally(() => prisma.$disconnect());
