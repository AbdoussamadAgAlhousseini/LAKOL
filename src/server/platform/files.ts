import "server-only";
import type { Document } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getSchoolContext, type SchoolContext } from "@/server/context";
import { canAll, canOnStudent } from "@/server/rbac/policies";
import { getStorage } from "@/server/adapters/storage";
import { canReadMessageAttachment } from "@/server/services/messaging";
import { canReadReportCard } from "@/server/services/report-cards";

/** Classe actuelle des élèves du périmètre (parent, élève). */
async function familyClassIds(ctx: SchoolContext) {
  const enrollments = await ctx.db.enrollment.findMany({
    where: {
      studentId: { in: [...ctx.scope.studentIds] },
      status: "ACTIVE",
      deletedAt: null,
      academicYear: { isActive: true },
    },
    select: { classId: true },
  });
  return new Set(enrollments.map((e) => e.classId));
}

async function canRead(ctx: SchoolContext, doc: Document): Promise<boolean> {
  switch (doc.entityType) {
    case "School":
      return true;
    case "Student":
      return canOnStudent(ctx.scope, "student.read", doc.entityId);
    case "Homework": {
      const hw = await ctx.db.homework.findUnique({ where: { id: doc.entityId } });
      if (!hw) return false;
      if (canAll(ctx.scope, "homework.read") || ctx.scope.classIds.has(hw.classId)) return true;
      return (await familyClassIds(ctx)).has(hw.classId);
    }
    case "HomeworkSubmission": {
      const sub = await ctx.db.homeworkSubmission.findUnique({ where: { id: doc.entityId } });
      return Boolean(sub && canOnStudent(ctx.scope, "student.read", sub.studentId));
    }
    case "Attendance": {
      const att = await ctx.db.attendance.findUnique({ where: { id: doc.entityId } });
      return Boolean(
        att && (canAll(ctx.scope, "attendance.read") || canOnStudent(ctx.scope, "student.read", att.studentId)),
      );
    }
    case "ReportCard":
      return canReadReportCard(ctx, doc.entityId);
    case "Message":
      return canReadMessageAttachment(ctx, doc.entityId);
    default:
      return false;
  }
}

/** Lit un fichier si l'utilisateur connecté y a droit dans son espace actif. */
export async function readAuthorizedFile(documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { school: true },
  });
  if (!doc) return null;
  const ctx = await getSchoolContext(doc.school.slug);
  if (!ctx || !(await canRead(ctx, doc))) return null;
  return { doc, body: await getStorage().get(doc.storageKey) };
}
