import "server-only";
import { randomUUID } from "node:crypto";
import type { CouncilDecision, Distinction } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { getStorage } from "@/server/adapters/storage";
import { canAll, canOnClass, ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import { renderReportCard } from "@/server/pdf/report-card";
import { actor, type ServiceContext } from "./context";
import { computeClassResults } from "./assessments";
import { notifyGuardians } from "./notify";
import { found } from "./structure";

export const DISTINCTION_LABELS: Record<Distinction, string> = {
  CONGRATULATIONS: "Félicitations",
  HONOR_ROLL: "Tableau d'honneur",
  ENCOURAGEMENT: "Encouragements",
  WORK_WARNING: "Avertissement travail",
  CONDUCT_WARNING: "Avertissement conduite",
};
export const DECISION_LABELS: Record<CouncilDecision, string> = {
  PROMOTED: "Admis(e) en classe supérieure",
  REPEAT: "Redouble",
  EXPELLED: "Exclu(e)",
  CONDITIONAL: "Passage conditionnel",
};

async function classOfStudent(ctx: ServiceContext, studentId: string, termId: string) {
  const term = await found(ctx.db.term.findUnique({ where: { id: termId } }));
  return found(
    ctx.db.enrollment.findFirst({
      where: { studentId, academicYearId: term.academicYearId, status: "ACTIVE", deletedAt: null },
      include: { class: true },
    }),
  );
}

// ── Appréciations et conseil ───────────────────────────────────────────────

/**
 * Appréciation d'une période. Par matière : le professeur de la matière.
 * Générale (`subjectId` vide) : le professeur principal ou la direction.
 */
export async function saveAppraisal(
  ctx: ServiceContext,
  input: { termId: string; studentId: string; subjectId?: string | null; comment: string },
) {
  const { class: cls } = await classOfStudent(ctx, input.studentId, input.termId);
  const subjectId = input.subjectId ?? "";
  if (subjectId) {
    const teaches = ctx.staffId
      ? await ctx.db.teachingAssignment.findFirst({ where: { classId: cls.id, subjectId, staffId: ctx.staffId } })
      : null;
    if (!teaches) throw new ForbiddenError();
  } else {
    const head =
      ctx.staffId && cls.headTeacherId === ctx.staffId && ctx.scope.permissions.has("reportcard.comment:own");
    if (!head && !canAll(ctx.scope, "council.manage")) throw new ForbiddenError();
  }
  const comment = input.comment.trim();
  if (!comment) {
    await ctx.db.appraisal.deleteMany({ where: { termId: input.termId, studentId: input.studentId, subjectId } });
    return;
  }
  await ctx.db.appraisal.upsert({
    where: { termId_studentId_subjectId: { termId: input.termId, studentId: input.studentId, subjectId } },
    create: {
      schoolId: ctx.school.id,
      termId: input.termId,
      studentId: input.studentId,
      subjectId,
      comment,
      authorId: ctx.user.id,
    },
    update: { comment, authorId: ctx.user.id },
  });
}

export async function saveCouncilDecision(
  ctx: ServiceContext,
  input: {
    termId: string;
    studentId: string;
    decision?: CouncilDecision | null;
    distinction?: Distinction | null;
    notes?: string | null;
  },
) {
  if (!canAll(ctx.scope, "council.manage")) throw new ForbiddenError();
  const enrollment = await classOfStudent(ctx, input.studentId, input.termId);
  const data = { decision: input.decision ?? null, distinction: input.distinction ?? null, notes: input.notes ?? null };
  const existing = await ctx.db.classCouncilDecision.findFirst({
    where: { studentId: input.studentId, termId: input.termId },
  });
  if (existing) await ctx.db.classCouncilDecision.update({ where: { id: existing.id }, data });
  else {
    await ctx.db.classCouncilDecision.create({
      data: {
        schoolId: ctx.school.id,
        classId: enrollment.classId,
        academicYearId: enrollment.academicYearId,
        termId: input.termId,
        studentId: input.studentId,
        ...data,
      },
    });
  }
}

/** Tableau du conseil de classe : résultats + appréciations + décisions. */
export async function councilSheet(ctx: ServiceContext, input: { classId: string; termId: string }) {
  if (!canOnClass(ctx.scope, "grade.read", input.classId)) throw new ForbiddenError();
  const results = await computeClassResults(ctx, input);
  const ids = results.students.map((s) => s.studentId);
  const [appraisals, decisions, cards, term] = await Promise.all([
    ctx.db.appraisal.findMany({ where: { termId: input.termId, studentId: { in: ids } } }),
    ctx.db.classCouncilDecision.findMany({ where: { termId: input.termId, studentId: { in: ids } } }),
    ctx.db.reportCard.findMany({ where: { termId: input.termId, studentId: { in: ids } } }),
    found(ctx.db.term.findUnique({ where: { id: input.termId }, include: { academicYear: true } })),
  ]);
  return {
    ...results,
    term,
    appraisals,
    decisions,
    cards,
    isHead: Boolean(ctx.staffId && results.class.headTeacherId === ctx.staffId),
  };
}

// ── Génération et publication ──────────────────────────────────────────────

async function schoolLogo(ctx: ServiceContext): Promise<Buffer | null> {
  const id = ctx.school.logoUrl?.match(/\/api\/files\/(\w+)/)?.[1];
  if (!id) return null;
  const doc = await ctx.db.document.findFirst({ where: { id, deletedAt: null } });
  if (!doc || !["image/png", "image/jpeg"].includes(doc.mimeType)) return null;
  try {
    return await getStorage().get(doc.storageKey);
  } catch {
    return null;
  }
}

/**
 * Calcule et édite les bulletins PDF d'une classe pour une période. Les notes
 * doivent avoir été validées (verrouillées) par la direction.
 */
export async function generateReportCards(ctx: ServiceContext, input: { classId: string; termId: string }) {
  if (!canAll(ctx.scope, "reportcard.publish")) throw new ForbiddenError();
  const sheet = await councilSheet(ctx, input);
  if (sheet.assessmentCount === 0) throw new DomainError("noAssessments");
  if (!sheet.locked) throw new DomainError("gradesNotValidated");

  const absences = await ctx.db.attendance.groupBy({
    by: ["studentId", "status"],
    where: {
      classId: input.classId,
      date: { gte: sheet.term.startDate, lte: sheet.term.endDate },
      status: { in: ["ABSENT", "EXCUSED", "LATE"] },
    },
    _count: { _all: true },
  });
  const logo = await schoolLogo(ctx);
  const dateFr = (d: Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(d);
  let generated = 0;

  for (const st of sheet.students) {
    const count = (status: string) =>
      absences.find((a) => a.studentId === st.studentId && a.status === status)?._count._all ?? 0;
    const decision = sheet.decisions.find((d) => d.studentId === st.studentId);
    const appraisalOf = (subjectId: string) =>
      sheet.appraisals.find((a) => a.studentId === st.studentId && a.subjectId === subjectId)?.comment ?? null;

    const pdf = await renderReportCard({
      school: {
        name: ctx.school.name,
        header: ctx.school.reportCardHeader,
        address: ctx.school.address,
        phone: ctx.school.phone,
        color: ctx.school.primaryColor,
        logo,
      },
      yearName: sheet.term.academicYear.name,
      termName: sheet.term.name,
      className: sheet.class.name,
      classSize: sheet.students.length,
      scale: sheet.scale,
      student: {
        name: `${st.lastName} ${st.firstName}`,
        matricule: st.matricule,
        gender: st.gender,
        birthDate: st.birthDate ? dateFr(st.birthDate) : null,
      },
      subjects: st.subjects.map((x) => ({ ...x, appraisal: appraisalOf(x.subjectId) })),
      average: st.average,
      rank: st.rank,
      classAverage: sheet.classStats.average,
      highest: sheet.classStats.highest,
      lowest: sheet.classStats.lowest,
      absences: { absent: count("ABSENT"), excused: count("EXCUSED"), late: count("LATE") },
      decision: decision?.decision ? DECISION_LABELS[decision.decision] : null,
      distinction: decision?.distinction ? DISTINCTION_LABELS[decision.distinction] : null,
      generalComment: appraisalOf(""),
      issuedAt: dateFr(new Date()),
    });

    const key = `schools/${ctx.school.id}/report-cards/${input.termId}/${st.studentId}-${randomUUID()}.pdf`;
    await getStorage().put(key, pdf, "application/pdf");
    const existing = sheet.cards.find((c) => c.studentId === st.studentId);
    if (existing?.documentId) {
      await ctx.db.document.updateMany({ where: { id: existing.documentId }, data: { deletedAt: new Date() } });
    }
    const card =
      existing ??
      (await ctx.db.reportCard.create({
        data: { schoolId: ctx.school.id, studentId: st.studentId, termId: input.termId, classId: input.classId },
      }));
    const doc = await ctx.db.document.create({
      data: {
        schoolId: ctx.school.id,
        entityType: "ReportCard",
        entityId: card.id,
        category: "REPORT_CARD",
        name: `Bulletin ${sheet.term.name} - ${st.lastName} ${st.firstName}.pdf`,
        mimeType: "application/pdf",
        size: pdf.length,
        storageKey: key,
        uploadedById: ctx.user.id,
      },
    });
    await ctx.db.reportCard.update({
      where: { id: card.id },
      data: {
        average: st.average,
        rank: st.rank,
        classAverage: sheet.classStats.average,
        highestAverage: sheet.classStats.highest,
        lowestAverage: sheet.classStats.lowest,
        subjects: st.subjects.map(({ grades: _grades, ...x }) => ({ ...x, appraisal: appraisalOf(x.subjectId) })),
        generalComment: appraisalOf(""),
        documentId: doc.id,
        status: existing?.status === "PUBLISHED" ? "PUBLISHED" : "VALIDATED",
      },
    });
    generated += 1;
  }
  await audit(ctx.db, actor(ctx), {
    action: "reportcard.generate",
    entityType: "Class",
    entityId: input.classId,
    after: { termId: input.termId, count: generated },
  });
  return { generated };
}

/** Publie les bulletins édités : visibles par les parents, qui sont prévenus. */
export async function publishReportCards(ctx: ServiceContext, input: { classId: string; termId: string }) {
  if (!canAll(ctx.scope, "reportcard.publish")) throw new ForbiddenError();
  const cards = await ctx.db.reportCard.findMany({
    where: { classId: input.classId, termId: input.termId, status: "VALIDATED" },
    include: { student: true, term: true },
  });
  if (cards.length === 0) throw new DomainError("nothingToPublish");
  const now = new Date();
  await ctx.db.reportCard.updateMany({
    where: { id: { in: cards.map((c) => c.id) } },
    data: { status: "PUBLISHED", publishedAt: now },
  });
  for (const card of cards) {
    await notifyGuardians(ctx, card.studentId, {
      type: "reportcard.published",
      title: `Bulletin disponible — ${card.student.firstName}`,
      body: `Le bulletin du ${card.term.name} de ${card.student.firstName} ${card.student.lastName} est disponible dans LAKOL.`,
      link: `/${ctx.school.slug}/report-cards`,
    });
  }
  await audit(ctx.db, actor(ctx), {
    action: "reportcard.publish",
    entityType: "Class",
    entityId: input.classId,
    after: { termId: input.termId, count: cards.length },
  });
  return { published: cards.length };
}

// ── Consultation par les familles ──────────────────────────────────────────

/** Reste à payer sur les factures échues (pour le blocage des bulletins). */
export async function overdueBalance(ctx: ServiceContext, studentId: string) {
  const sums = await ctx.db.invoice.aggregate({
    where: { studentId, status: { in: ["UNPAID", "PARTIAL"] }, deletedAt: null, dueDate: { lte: new Date() } },
    _sum: { total: true, amountPaid: true },
  });
  return (sums._sum.total ?? 0) - (sums._sum.amountPaid ?? 0);
}

/** Le bulletin est-il bloqué pour la famille (option de l'école + impayé échu) ? */
export async function isReportBlocked(ctx: ServiceContext, studentId: string) {
  if (!ctx.school.blockReportIfUnpaid) return false;
  return (await overdueBalance(ctx, studentId)) > 0;
}

/** Bulletins publiés des enfants (ou de l'élève), avec l'éventuel blocage. */
export async function familyReportCards(ctx: ServiceContext) {
  const ids = [...ctx.scope.studentIds];
  const cards = await ctx.db.reportCard.findMany({
    where: { studentId: { in: ids }, status: "PUBLISHED" },
    include: { student: true, term: { include: { academicYear: true } }, class: true },
    orderBy: [{ term: { academicYear: { startDate: "desc" } } }, { term: { order: "desc" } }],
  });
  const links = await ctx.db.studentGuardian.findMany({
    where: { studentId: { in: ids }, guardian: { userId: ctx.user.id } },
  });
  return Promise.all(
    cards.map(async (c) => {
      const link = links.find((l) => l.studentId === c.studentId);
      return {
        ...c,
        hiddenGrades: link ? !link.canViewGrades : false,
        blocked: await isReportBlocked(ctx, c.studentId),
      };
    }),
  );
}

/** Contrôle d'accès au PDF d'un bulletin (personnel ou famille). */
export async function canReadReportCard(ctx: ServiceContext, reportCardId: string) {
  const card = await ctx.db.reportCard.findUnique({ where: { id: reportCardId } });
  if (!card) return false;
  // Personnel : toute l'école, ou les classes du professeur.
  if (canAll(ctx.scope, "grade.read") || ctx.scope.classIds.has(card.classId)) return true;
  // Famille : bulletin publié, notes visibles pour ce parent, pas de blocage pour impayé.
  try {
    requireStudentAccess(ctx.scope, "grade.read", card.studentId);
  } catch {
    return false;
  }
  if (card.status !== "PUBLISHED") return false;
  const link = await ctx.db.studentGuardian.findFirst({
    where: { studentId: card.studentId, guardian: { userId: ctx.user.id } },
  });
  if (link && !link.canViewGrades) return false;
  return !(await isReportBlocked(ctx, card.studentId));
}

// ── Carte scolaire ─────────────────────────────────────────────────────────

/** Carte scolaire PDF (photo, classe, QR code du matricule). */
export async function studentCardPdf(ctx: ServiceContext, studentId: string) {
  requireStudentAccess(ctx.scope, "student.read", studentId);
  const { renderStudentCard } = await import("@/server/pdf/student-card");
  const student = await found(ctx.db.student.findFirst({ where: { id: studentId, deletedAt: null } }));
  const year = await ctx.db.academicYear.findFirst({ where: { isActive: true } });
  const enrollment = year
    ? await ctx.db.enrollment.findFirst({
        where: { studentId, academicYearId: year.id, deletedAt: null },
        include: { class: true },
      })
    : null;
  const photoId = student.photoUrl?.match(/\/api\/files\/(\w+)/)?.[1];
  const photoDoc = photoId ? await ctx.db.document.findFirst({ where: { id: photoId, deletedAt: null } }) : null;
  const photo =
    photoDoc && ["image/png", "image/jpeg"].includes(photoDoc.mimeType)
      ? await getStorage()
          .get(photoDoc.storageKey)
          .catch(() => null)
      : null;
  return renderStudentCard({
    school: {
      name: ctx.school.name,
      color: ctx.school.primaryColor,
      phone: ctx.school.phone,
      logo: await schoolLogo(ctx),
    },
    yearName: year?.name ?? "",
    student: {
      name: `${student.lastName} ${student.firstName}`,
      matricule: student.matricule,
      className: enrollment?.class.name ?? null,
      birthDate: student.birthDate
        ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(student.birthDate)
        : null,
      photo,
    },
    qr: `LAKOL:${ctx.school.slug}:${student.matricule}`,
  });
}
