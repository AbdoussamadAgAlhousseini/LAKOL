import "server-only";
import type { ModuleKey } from "@prisma/client";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { activeStudentCount, limitsOf, setModule } from "@/server/platform/subscriptions";
import { effectiveModules, MODULE_KEYS } from "@/lib/modules";
import type { ServiceContext } from "./context";
import { whatsappUsage } from "./notify";

function requireManager(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "school.settings.manage")) throw new ForbiddenError();
}

/** Page « Abonnement » de l'école : formule, état, usage, modules, factures LAKOL. */
export async function schoolSubscription(ctx: ServiceContext) {
  requireManager(ctx);
  const [subscription, settings, invoices, students, whatsapp] = await Promise.all([
    ctx.db.subscription.findFirst({ include: { plan: true } }),
    ctx.db.moduleActivation.findMany(),
    ctx.db.platformInvoice.findMany({ orderBy: { createdAt: "desc" } }),
    activeStudentCount(ctx.school.id),
    whatsappUsage(ctx),
  ]);
  const planModules = subscription?.plan.modules ?? [];
  const active = effectiveModules(planModules, settings);
  return {
    subscription,
    limits: subscription ? limitsOf(subscription) : null,
    students,
    whatsapp,
    invoices,
    modules: MODULE_KEYS.map((key: ModuleKey) => ({
      key,
      inPlan: planModules.includes(key),
      active: active.has(key),
    })),
  };
}

/** L'école désactive (ou réactive) un module de sa formule, ex. ne pas utiliser les finances. */
export async function toggleSchoolModule(ctx: ServiceContext, module: ModuleKey, enabled: boolean) {
  requireManager(ctx);
  await setModule(ctx.school.id, module, enabled, { platform: false, actorId: ctx.user.id });
}
