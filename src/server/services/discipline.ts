import "server-only";
import type { IncidentType } from "@prisma/client";
import { audit } from "@/server/audit";
import { canAll, ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import { actor, paginate, type ServiceContext } from "./context";
import { notifyGuardians } from "./notify";
import { found } from "./structure";

const TYPE_LABELS: Record<IncidentType, string> = {
  INCIDENT: "Incident",
  WARNING: "Avertissement",
  SANCTION: "Sanction",
  SUMMONS: "Convocation",
};

/** Enregistre un incident ; les parents sont prévenus pour avertissement, sanction et convocation. */
export async function createIncident(
  ctx: ServiceContext,
  input: { studentId: string; type: IncidentType; date: Date; description: string; sanction?: string | null },
) {
  if (!canAll(ctx.scope, "discipline.write")) throw new ForbiddenError();
  const student = await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  const incident = await ctx.db.disciplineIncident.create({
    data: {
      schoolId: ctx.school.id,
      studentId: student.id,
      type: input.type,
      date: input.date,
      description: input.description,
      sanction: input.sanction ?? null,
      reportedById: ctx.user.id,
    },
  });
  if (input.type !== "INCIDENT") {
    await notifyGuardians(ctx, student.id, {
      type: `discipline.${input.type.toLowerCase()}`,
      title: `${TYPE_LABELS[input.type]} — ${student.firstName} ${student.lastName}`,
      body: [input.description, input.sanction].filter(Boolean).join("\n"),
      link: `/${ctx.school.slug}/attendance`,
    });
  }
  await audit(ctx.db, actor(ctx), {
    action: "discipline.create",
    entityType: "Student",
    entityId: student.id,
    after: { type: input.type, sanction: input.sanction ?? null },
  });
  return incident;
}

export async function deleteIncident(ctx: ServiceContext, id: string) {
  if (!canAll(ctx.scope, "discipline.write")) throw new ForbiddenError();
  const incident = await found(ctx.db.disciplineIncident.findFirst({ where: { id, deletedAt: null } }));
  await ctx.db.disciplineIncident.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx.db, actor(ctx), {
    action: "discipline.delete",
    entityType: "Student",
    entityId: incident.studentId,
    before: incident,
  });
}

export async function listIncidents(ctx: ServiceContext, filters: { studentId?: string; page?: number }) {
  if (filters.studentId) requireStudentAccess(ctx.scope, "student.read", filters.studentId);
  else if (!canAll(ctx.scope, "discipline.read")) throw new ForbiddenError();
  const { skip, take, page } = paginate(filters.page);
  const where = { deletedAt: null, ...(filters.studentId ? { studentId: filters.studentId } : {}) };
  const [items, total] = await Promise.all([
    ctx.db.disciplineIncident.findMany({ where, include: { student: true }, orderBy: { date: "desc" }, skip, take }),
    ctx.db.disciplineIncident.count({ where }),
  ]);
  return { items, total, page };
}
