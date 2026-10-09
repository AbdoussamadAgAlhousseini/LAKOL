import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool } from "@/server/db/tenant";
import { loadScope } from "@/server/scope";
import { permissionsForModules } from "@/server/rbac/permissions";
import { effectiveModules } from "@/lib/modules";
import type { ServiceContext } from "@/server/services/context";
import { getWhatsAppProvider, type MockWhatsAppProvider } from "@/server/adapters/whatsapp";

/** Contexte de service tel que le construit l'application pour cet utilisateur et ce rôle. */
export async function contextFor(
  slug: string,
  where: Prisma.UserWhereUniqueInput,
  roleKey: string,
): Promise<ServiceContext> {
  const {
    subscription,
    modules: settings,
    ...school
  } = await prisma.school.findUniqueOrThrow({
    where: { slug },
    include: { subscription: { include: { plan: true } }, modules: true },
  });
  const modules = effectiveModules(subscription?.plan.modules ?? [], settings);
  const user = await prisma.user.findUniqueOrThrow({ where });
  const role = await prisma.role.findFirstOrThrow({
    where: { schoolId: school.id, key: roleKey, users: { some: { userId: user.id } } },
    include: { permissions: true },
  });
  const db = forSchool(school.id);
  const { classIds, studentIds, staffId } = await loadScope(db, user.id, roleKey);
  return {
    db,
    school,
    user,
    ip: null,
    staffId,
    scope: {
      permissions: permissionsForModules(
        role.permissions.map((p) => p.permissionKey),
        modules,
      ),
      classIds,
      studentIds,
    },
  };
}

export function whatsapp() {
  return getWhatsAppProvider() as MockWhatsAppProvider;
}

let phoneCounter = 0;
/** Numéro unique par exécution, pour ne pas dépendre de l'état de la base. */
export function uniquePhone() {
  phoneCounter += 1;
  return `+2236${String(Date.now()).slice(-5)}${String(phoneCounter).padStart(2, "0")}`;
}
