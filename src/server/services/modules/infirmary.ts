import "server-only";
import type { InfirmaryOutcome } from "@prisma/client";
import { audit } from "@/server/audit";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { formatTime } from "@/lib/time";
import { actor, paginate, type ServiceContext } from "../context";
import { notifyGuardians } from "../notify";
import { found } from "../structure";

function requireNurse(ctx: ServiceContext) {
  // Données de santé : réservées à l'infirmerie (et à la direction).
  if (!canAll(ctx.scope, "infirmary.manage")) throw new ForbiddenError();
}

export async function listVisits(ctx: ServiceContext, filters: { studentId?: string; page?: number }) {
  requireNurse(ctx);
  const { skip, take, page } = paginate(filters.page);
  const where = filters.studentId ? { studentId: filters.studentId } : {};
  const [items, total] = await Promise.all([
    ctx.db.infirmaryVisit.findMany({ where, include: { student: true }, orderBy: { at: "desc" }, skip, take }),
    ctx.db.infirmaryVisit.count({ where }),
  ]);
  return { items, total, page };
}

/**
 * Enregistre un passage à l'infirmerie. Si l'élève rentre chez lui ou est
 * orienté vers un médecin, ses parents sont prévenus immédiatement.
 */
export async function recordVisit(
  ctx: ServiceContext,
  input: { studentId: string; reason: string; care?: string | null; outcome: InfirmaryOutcome },
) {
  requireNurse(ctx);
  const student = await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  const notify = input.outcome === "SENT_HOME" || input.outcome === "REFERRED";
  const visit = await ctx.db.infirmaryVisit.create({
    data: {
      schoolId: ctx.school.id,
      studentId: student.id,
      reason: input.reason,
      care: input.care ?? null,
      outcome: input.outcome,
      parentNotified: notify,
      recordedById: ctx.user.id,
    },
  });
  if (notify) {
    const now = new Date();
    const time = formatTime(now.getUTCHours() * 60 + now.getUTCMinutes());
    await notifyGuardians(ctx, student.id, {
      type: "infirmary.visit",
      title: `Infirmerie — ${student.firstName}`,
      body:
        input.outcome === "SENT_HOME"
          ? `${student.firstName} est passé(e) à l'infirmerie à ${time} (${input.reason}). Merci de venir le/la chercher ou de contacter l'école.`
          : `${student.firstName} est passé(e) à l'infirmerie à ${time} (${input.reason}). L'infirmerie recommande de consulter un médecin.`,
      urgent: true,
    });
  }
  await audit(ctx.db, actor(ctx), {
    action: "infirmary.visit",
    entityType: "Student",
    entityId: student.id,
    after: { outcome: input.outcome, parentNotified: notify },
  });
  return visit;
}

/** Fiche santé utile au soin : allergies, groupe sanguin, contacts. */
export async function healthCard(ctx: ServiceContext, studentId: string) {
  requireNurse(ctx);
  if (!canAll(ctx.scope, "student.medical.read")) throw new ForbiddenError();
  return found(
    ctx.db.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } },
    }),
  );
}
