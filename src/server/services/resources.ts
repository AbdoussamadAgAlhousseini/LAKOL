import "server-only";
import type { ResourceType } from "@prisma/client";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { paginate, type ServiceContext } from "./context";
import { storeDocument } from "./students";
import { found, getActiveYear } from "./structure";

/**
 * Niveaux visibles par l'utilisateur : tous pour le personnel, ceux des
 * classes de ses enfants (ou de sa classe) pour une famille ou un élève.
 */
async function visibleLevelIds(ctx: ServiceContext): Promise<string[] | null> {
  if (canAll(ctx.scope, "resource.write") || canAll(ctx.scope, "student.read") || ctx.staffId) return null;
  const year = await getActiveYear(ctx);
  const enrollments = await ctx.db.enrollment.findMany({
    where: { studentId: { in: [...ctx.scope.studentIds] }, academicYearId: year?.id ?? "", status: "ACTIVE" },
    include: { class: { select: { levelId: true } } },
  });
  return [...new Set(enrollments.map((e) => e.class.levelId))];
}

/** Bibliothèque numérique : cours, exercices, corrigés, sujets d'examens, par matière et niveau. */
export async function listResources(
  ctx: ServiceContext,
  filters: { subjectId?: string; levelId?: string; type?: ResourceType; q?: string; page?: number },
) {
  if (!ctx.scope.permissions.has("resource.read")) throw new ForbiddenError();
  const levels = await visibleLevelIds(ctx);
  const { skip, take, page } = paginate(filters.page);
  const where = {
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.q ? { title: { contains: filters.q, mode: "insensitive" as const } } : {}),
    // Famille : ressources de ses niveaux, ou communes à tous les niveaux.
    ...(levels
      ? { OR: [{ levelId: null }, { levelId: { in: filters.levelId ? [filters.levelId] : levels } }] }
      : filters.levelId
        ? { levelId: filters.levelId }
        : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.resource.findMany({
      where,
      include: { subject: true, level: true },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    ctx.db.resource.count({ where }),
  ]);
  return { items, total, page };
}

/** Matières dans lesquelles l'utilisateur peut publier (toutes pour la direction). */
export async function publishableSubjects(ctx: ServiceContext) {
  if (!ctx.scope.permissions.has("resource.write")) return [];
  if (canAll(ctx.scope, "school.structure.manage")) return ctx.db.subject.findMany({ orderBy: { name: "asc" } });
  if (!ctx.staffId) return [];
  const assignments = await ctx.db.teachingAssignment.findMany({
    where: { staffId: ctx.staffId },
    include: { subject: true },
  });
  return [...new Map(assignments.map((a) => [a.subjectId, a.subject])).values()];
}

export async function createResource(
  ctx: ServiceContext,
  input: {
    subjectId: string;
    levelId?: string | null;
    type: ResourceType;
    title: string;
    description?: string | null;
    url?: string | null;
    file?: File | null;
  },
) {
  const subjects = await publishableSubjects(ctx);
  if (!subjects.some((s) => s.id === input.subjectId)) throw new ForbiddenError();
  if (!input.url && !input.file) throw new DomainError("fileOrLinkRequired", "file");
  if (input.levelId) await found(ctx.db.level.findUnique({ where: { id: input.levelId } }));
  const resource = await ctx.db.resource.create({
    data: {
      schoolId: ctx.school.id,
      subjectId: input.subjectId,
      levelId: input.levelId ?? null,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      url: input.url ?? null,
      createdById: ctx.user.id,
    },
  });
  if (input.file) {
    const doc = await storeDocument(ctx, {
      entityType: "Resource",
      entityId: resource.id,
      category: "RESOURCE",
      file: input.file,
    });
    await ctx.db.resource.update({ where: { id: resource.id }, data: { documentId: doc.id } });
  }
  return resource;
}

/** Suppression par son auteur ou par la direction. */
export async function deleteResource(ctx: ServiceContext, id: string) {
  const resource = await found(ctx.db.resource.findUnique({ where: { id } }));
  if (resource.createdById !== ctx.user.id && !canAll(ctx.scope, "school.structure.manage")) throw new ForbiddenError();
  await ctx.db.resource.delete({ where: { id } });
  if (resource.documentId) {
    await ctx.db.document.update({ where: { id: resource.documentId }, data: { deletedAt: new Date() } });
  }
}

/** Droit de télécharger le fichier d'une ressource. */
export async function canReadResource(ctx: ServiceContext, id: string) {
  if (!ctx.scope.permissions.has("resource.read")) return false;
  const resource = await ctx.db.resource.findUnique({ where: { id } });
  if (!resource) return false;
  const levels = await visibleLevelIds(ctx);
  return !levels || !resource.levelId || levels.includes(resource.levelId);
}
