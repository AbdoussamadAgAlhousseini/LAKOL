import "server-only";
import { prisma } from "@/server/db/client";
import { getSchoolContext } from "@/server/context";
import { canOnStudent } from "@/server/rbac/policies";
import { getStorage } from "@/server/adapters/storage";

/**
 * Lit un fichier si l'utilisateur connecté y a droit dans son espace actif :
 * documents d'élève selon le périmètre, logo pour tout membre de l'école.
 */
export async function readAuthorizedFile(documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { school: true },
  });
  if (!doc) return null;
  const ctx = await getSchoolContext(doc.school.slug);
  if (!ctx) return null;

  const allowed =
    doc.entityType === "School"
      ? true
      : doc.entityType === "Student"
        ? canOnStudent(ctx.scope, "student.read", doc.entityId)
        : false;
  if (!allowed) return null;
  return { doc, body: await getStorage().get(doc.storageKey) };
}
