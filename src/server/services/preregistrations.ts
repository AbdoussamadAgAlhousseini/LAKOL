import "server-only";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { actor, paginate, type ServiceContext } from "./context";
import { found } from "./structure";
import { createStudent } from "./students";

export async function listPreRegistrations(
  ctx: ServiceContext,
  filters: { status?: "PENDING" | "ACCEPTED" | "REJECTED"; page?: number },
) {
  const { skip, take, page } = paginate(filters.page);
  const where = { status: filters.status ?? "PENDING" } as const;
  const [items, total] = await Promise.all([
    ctx.db.preRegistration.findMany({ where, include: { level: true }, orderBy: { createdAt: "desc" }, skip, take }),
    ctx.db.preRegistration.count({ where }),
  ]);
  return { items, total, page };
}

export async function countPendingPreRegistrations(ctx: ServiceContext) {
  return ctx.db.preRegistration.count({ where: { status: "PENDING" } });
}

/** Valide une pré-inscription : l'élève est inscrit dans la classe choisie, le parent reçoit ses accès. */
export async function acceptPreRegistration(ctx: ServiceContext, input: { id: string; classId: string }) {
  const pre = await found(ctx.db.preRegistration.findUnique({ where: { id: input.id } }));
  if (pre.status !== "PENDING") throw new DomainError("alreadyProcessed");
  const cls = await found(ctx.db.class.findUnique({ where: { id: input.classId } }));
  if (cls.levelId !== pre.levelId) throw new DomainError("levelMismatch", "classId");

  const student = await createStudent(ctx, {
    firstName: pre.firstName,
    lastName: pre.lastName,
    gender: pre.gender,
    birthDate: pre.birthDate,
    birthPlace: pre.birthPlace,
    classId: input.classId,
    guardians: [
      {
        firstName: pre.guardianFirstName,
        lastName: pre.guardianLastName,
        phone: pre.guardianPhone,
        email: pre.guardianEmail,
        relationship: pre.guardianRelation,
        isPrimary: true,
      },
    ],
  });
  await ctx.db.preRegistration.update({
    where: { id: pre.id },
    data: { status: "ACCEPTED", studentId: student.id, reviewedById: ctx.user.id, reviewedAt: new Date() },
  });
  return student;
}

export async function rejectPreRegistration(ctx: ServiceContext, input: { id: string; reason?: string | null }) {
  const pre = await found(ctx.db.preRegistration.findUnique({ where: { id: input.id } }));
  if (pre.status !== "PENDING") throw new DomainError("alreadyProcessed");
  await ctx.db.preRegistration.update({
    where: { id: pre.id },
    data: {
      status: "REJECTED",
      rejectionReason: input.reason ?? null,
      reviewedById: ctx.user.id,
      reviewedAt: new Date(),
    },
  });
  await audit(ctx.db, actor(ctx), {
    action: "preRegistration.reject",
    entityType: "PreRegistration",
    entityId: pre.id,
    after: { reason: input.reason ?? null },
  });
}
