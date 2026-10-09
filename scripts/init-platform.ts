/* Initialise (ou met à jour) une plateforme de production. Idempotent :
 *   - catalogue des permissions et permissions par défaut des rôles ;
 *   - formules Essai, Standard, Premium si elles n'existent pas ;
 *   - compte super admin (ADMIN_EMAIL), si ADMIN_PASSWORD est fourni.
 * Lancement : pnpm platform:init (après pnpm db:deploy). Ne crée aucune donnée de démonstration. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { ensurePlans, ensureSuperAdmin, syncPermissions } from "../src/server/platform/bootstrap";

const prisma = new PrismaClient();

async function main() {
  const permissions = await syncPermissions(prisma);
  console.log(`Permissions : ${permissions.catalog} au catalogue, ${permissions.added} ajoutées aux rôles.`);
  const plans = await ensurePlans(prisma);
  console.log(`Formules : ${plans.created} créée(s).`);

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME } = process.env;
  if (!ADMIN_EMAIL) {
    console.log("ADMIN_EMAIL absent : aucun compte super admin créé.");
    return;
  }
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    console.error("ADMIN_PASSWORD doit faire au moins 12 caractères.");
    process.exitCode = 1;
    return;
  }
  const admin = await ensureSuperAdmin(prisma, {
    email: ADMIN_EMAIL,
    firstName: ADMIN_FIRST_NAME ?? "Super",
    lastName: ADMIN_LAST_NAME ?? "Admin",
    passwordHash: await hashPassword(ADMIN_PASSWORD),
  });
  console.log(
    admin.created
      ? `Super admin créé : ${admin.email}`
      : `Super admin existant : ${admin.email} (mot de passe inchangé)`,
  );
}

main().finally(() => prisma.$disconnect());
