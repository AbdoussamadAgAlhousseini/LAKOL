import "server-only";
import { randomUUID } from "node:crypto";
import type { Gender, GuardianRelationship, Prisma, StudentStatus } from "@prisma/client";
import { audit } from "@/server/audit";
import { nextSequence } from "@/server/db/sequence";
import { DomainError, NotFoundError } from "@/server/errors";
import { getStorage } from "@/server/adapters/storage";
import { canAll, requireStudentAccess } from "@/server/rbac/policies";
import { actor, paginate, type ServiceContext } from "./context";
import { ensureUser, grantRole, resetToTemporaryPassword, revokeRole, sendAccess } from "./accounts";
import { found, requireActiveYear } from "./structure";

// ── Lecture ────────────────────────────────────────────────────────────────

export interface StudentFilters {
  q?: string;
  classId?: string;
  status?: StudentStatus;
  page?: number;
}

/** Liste paginée ; limitée au périmètre `:own` pour un professeur. */
export async function listStudents(ctx: ServiceContext, filters: StudentFilters) {
  const year = await ctx.db.academicYear.findFirst({ where: { isActive: true } });
  const { skip, take, page } = paginate(filters.page);
  const q = filters.q?.trim();

  const where: Prisma.StudentWhereInput = {
    deletedAt: null,
    ...(canAll(ctx.scope, "student.read") ? {} : { id: { in: [...ctx.scope.studentIds] } }),
    ...(filters.status ? { status: filters.status } : { status: { notIn: ["PRE_REGISTERED"] } }),
    ...(filters.classId
      ? { enrollments: { some: { classId: filters.classId, academicYearId: year?.id, deletedAt: null } } }
      : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { matricule: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    ctx.db.student.findMany({
      where,
      include: {
        enrollments: { where: { academicYearId: year?.id ?? "", deletedAt: null }, include: { class: true } },
        guardians: { where: { isPrimary: true }, include: { guardian: true }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip,
      take,
    }),
    ctx.db.student.count({ where }),
  ]);
  return { items, total, page };
}

export async function getStudent(ctx: ServiceContext, id: string) {
  requireStudentAccess(ctx.scope, "student.read", id);
  const student = await ctx.db.student.findFirst({
    where: { id, deletedAt: null },
    include: {
      user: { select: { id: true, username: true, lastLoginAt: true, mustChangePwd: true } },
      guardians: {
        include: { guardian: { include: { user: { select: { id: true, lastLoginAt: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      enrollments: {
        where: { deletedAt: null },
        include: { class: { include: { level: true } }, academicYear: true },
        orderBy: { academicYear: { startDate: "desc" } },
      },
    },
  });
  if (!student) throw new NotFoundError();
  const documents = await ctx.db.document.findMany({
    where: { entityType: "Student", entityId: id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { ...student, documents };
}

// ── Création ───────────────────────────────────────────────────────────────

export interface GuardianInput {
  firstName: string;
  lastName: string;
  phone: string; // E.164
  email?: string | null;
  profession?: string | null;
  relationship: GuardianRelationship;
  isPrimary?: boolean;
}

export interface StudentInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate?: Date | null;
  birthPlace?: string | null;
  nationality?: string | null;
  address?: string | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  medicalNotes?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
}

function studentData(input: StudentInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender,
    birthDate: input.birthDate ?? null,
    birthPlace: input.birthPlace ?? null,
    nationality: input.nationality ?? null,
    address: input.address ?? null,
    bloodGroup: input.bloodGroup ?? null,
    allergies: input.allergies ?? null,
    medicalNotes: input.medicalNotes ?? null,
    emergencyContacts: input.emergencyPhone
      ? [{ name: input.emergencyName ?? "", phone: input.emergencyPhone, relationship: "" }]
      : [],
  };
}

/** Matricule : préfixe de l'école, année, numéro séquentiel (ex. ETO-25-0031). */
async function generateMatricule(ctx: ServiceContext, tx: Parameters<typeof nextSequence>[0], yearStart: Date) {
  const yy = String(yearStart.getUTCFullYear()).slice(-2);
  const prefix = ctx.school.slug
    .replace(/[^a-z]/gi, "")
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, "X");
  const seq = await nextSequence(tx, ctx.school.id, `matricule:${yy}`);
  return `${prefix}-${yy}-${String(seq).padStart(4, "0")}`;
}

async function assertClassAvailable(ctx: ServiceContext, classId: string, academicYearId: string) {
  const cls = await found(
    ctx.db.class.findUnique({
      where: { id: classId },
      include: {
        level: true,
        _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
      },
    }),
  );
  if (cls.academicYearId !== academicYearId) throw new DomainError("classNotInActiveYear", "classId");
  if (cls.capacity && cls._count.enrollments >= cls.capacity) throw new DomainError("classFull", "classId");
  return cls;
}

/**
 * Inscrit un élève : fiche, matricule, inscription dans la classe, tuteurs
 * (comptes parents créés ou réutilisés) puis envoi des accès par WhatsApp.
 */
export async function createStudent(
  ctx: ServiceContext,
  input: StudentInput & {
    classId: string;
    guardians: GuardianInput[];
    sendAccess?: boolean;
    type?: "NEW" | "TRANSFER_IN";
  },
) {
  if (input.guardians.length === 0) throw new DomainError("guardianRequired");
  const year = await requireActiveYear(ctx);
  await assertClassAvailable(ctx, input.classId, year.id);

  const student = await ctx.db.$transaction(async (tx) => {
    const matricule = await generateMatricule(ctx, tx, year.startDate);
    const created = await tx.student.create({
      data: { schoolId: ctx.school.id, matricule, status: "ACTIVE", ...studentData(input) },
    });
    await tx.enrollment.create({
      data: {
        schoolId: ctx.school.id,
        studentId: created.id,
        classId: input.classId,
        academicYearId: year.id,
        type: input.type ?? "NEW",
      },
    });
    return created;
  });

  const hasPrimary = input.guardians.some((g) => g.isPrimary);
  for (const [i, g] of input.guardians.entries()) {
    await linkGuardian(
      ctx,
      student.id,
      { ...g, isPrimary: g.isPrimary ?? (!hasPrimary && i === 0) },
      input.sendAccess ?? true,
    );
  }
  await audit(ctx.db, actor(ctx), {
    action: "student.create",
    entityType: "Student",
    entityId: student.id,
    after: { matricule: student.matricule, classId: input.classId },
  });
  return student;
}

/** Fiche tuteur de l'école (réutilisée si le numéro existe déjà) + compte parent. */
async function upsertGuardian(ctx: ServiceContext, input: GuardianInput) {
  const { user, tempPassword } = await ensureUser(ctx, {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    email: input.email ?? null,
  });
  let guardian = await ctx.db.guardian.findFirst({ where: { phone: input.phone, deletedAt: null } });
  if (!guardian) {
    guardian = await ctx.db.guardian.create({
      data: {
        schoolId: ctx.school.id,
        userId: user.id,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email ?? null,
        profession: input.profession ?? null,
      },
    });
  } else if (!guardian.userId) {
    guardian = await ctx.db.guardian.update({ where: { id: guardian.id }, data: { userId: user.id } });
  }
  const hadRole = await ctx.db.userRole.findFirst({ where: { userId: user.id, role: { key: "PARENT" } } });
  await grantRole(ctx, user.id, "PARENT");
  return { guardian, user, tempPassword, newAccess: !hadRole };
}

/** Rattache un tuteur à un élève ; envoie ses accès s'il est nouveau dans l'école. */
export async function linkGuardian(ctx: ServiceContext, studentId: string, input: GuardianInput, notify = true) {
  await found(ctx.db.student.findUnique({ where: { id: studentId } }));
  const { guardian, user, tempPassword, newAccess } = await upsertGuardian(ctx, input);

  const existing = await ctx.db.studentGuardian.findFirst({ where: { studentId, guardianId: guardian.id } });
  if (existing) throw new DomainError("guardianAlreadyLinked", "phone");
  if (input.isPrimary) {
    await ctx.db.studentGuardian.updateMany({ where: { studentId }, data: { isPrimary: false } });
  }
  const link = await ctx.db.studentGuardian.create({
    data: {
      schoolId: ctx.school.id,
      studentId,
      guardianId: guardian.id,
      relationship: input.relationship,
      isPrimary: input.isPrimary ?? false,
    },
  });
  if (notify && (tempPassword || newAccess)) await sendAccess(ctx, user, "parent", tempPassword);
  return link;
}

export async function updateGuardianLink(
  ctx: ServiceContext,
  input: {
    linkId: string;
    relationship: GuardianRelationship;
    isPrimary: boolean;
    canViewGrades: boolean;
    canViewFinance: boolean;
    receivesNotifications: boolean;
  },
) {
  const link = await found(ctx.db.studentGuardian.findUnique({ where: { id: input.linkId } }));
  if (input.isPrimary) {
    await ctx.db.studentGuardian.updateMany({ where: { studentId: link.studentId }, data: { isPrimary: false } });
  }
  const { linkId, ...data } = input;
  await ctx.db.studentGuardian.update({ where: { id: linkId }, data });
  await audit(ctx.db, actor(ctx), {
    action: "guardian.rights",
    entityType: "StudentGuardian",
    entityId: linkId,
    before: link,
    after: data,
  });
}

export async function unlinkGuardian(ctx: ServiceContext, linkId: string) {
  const link = await found(ctx.db.studentGuardian.findUnique({ where: { id: linkId }, include: { guardian: true } }));
  const count = await ctx.db.studentGuardian.count({ where: { studentId: link.studentId } });
  if (count <= 1) throw new DomainError("lastGuardian");
  await ctx.db.studentGuardian.delete({ where: { id: linkId } });
  // Plus aucun enfant dans l'école : le rôle parent est retiré.
  const remaining = await ctx.db.studentGuardian.count({ where: { guardianId: link.guardianId } });
  if (remaining === 0 && link.guardian.userId) await revokeRole(ctx, link.guardian.userId, "PARENT");
  await audit(ctx.db, actor(ctx), {
    action: "guardian.unlink",
    entityType: "StudentGuardian",
    entityId: linkId,
    before: link,
  });
}

/**
 * Renvoie les accès d'un tuteur avec un nouveau mot de passe provisoire.
 * Refusé si le compte sert dans une autre école : le parent utilise alors
 * « mot de passe oublié » (une école ne réinitialise pas un compte partagé).
 */
export async function resendGuardianAccess(ctx: ServiceContext, guardianId: string) {
  const guardian = await found(ctx.db.guardian.findUnique({ where: { id: guardianId }, include: { user: true } }));
  if (!guardian.user) throw new DomainError("noAccount");
  await assertAccountOwnedBySchool(ctx, guardian.user.id);
  const tempPassword = await resetToTemporaryPassword(ctx, guardian.user.id);
  await sendAccess(ctx, guardian.user, "parent", tempPassword);
  await audit(ctx.db, actor(ctx), { action: "account.reset", entityType: "User", entityId: guardian.user.id });
}

export async function assertAccountOwnedBySchool(ctx: ServiceContext, userId: string) {
  const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isPlatformAdmin) throw new DomainError("accountShared");
  const elsewhere = await ctx.db.user.count({
    where: { id: userId, roles: { some: { schoolId: { not: ctx.school.id } } } },
  });
  if (elsewhere > 0) throw new DomainError("accountShared");
}

// ── Modification et parcours ───────────────────────────────────────────────

export async function updateStudent(ctx: ServiceContext, id: string, input: StudentInput) {
  const before = await found(ctx.db.student.findFirst({ where: { id, deletedAt: null } }));
  const data = studentData(input);
  const updated = await ctx.db.student.update({ where: { id }, data });
  await audit(ctx.db, actor(ctx), {
    action: "student.update",
    entityType: "Student",
    entityId: id,
    before: pick(before, Object.keys(data)),
    after: data,
  });
  return updated;
}

function pick(obj: object, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
}

const LEAVING: Record<string, "TRANSFERRED" | "DROPPED" | "EXPELLED"> = {
  TRANSFERRED: "TRANSFERRED",
  DROPPED: "DROPPED",
  EXPELLED: "EXPELLED",
};

/** Transfert, abandon, exclusion (ou réintégration). Tracé dans le journal d'audit. */
export async function changeStudentStatus(
  ctx: ServiceContext,
  input: { studentId: string; status: "ACTIVE" | "TRANSFERRED" | "DROPPED" | "EXPELLED"; reason?: string | null },
) {
  const student = await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  const year = await requireActiveYear(ctx);
  const enrollment = await ctx.db.enrollment.findFirst({
    where: { studentId: student.id, academicYearId: year.id, deletedAt: null },
  });
  const leaving = LEAVING[input.status];

  await ctx.db.$transaction(async (tx) => {
    await tx.student.update({ where: { id: student.id }, data: { status: input.status } });
    if (enrollment) {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: leaving
          ? { status: leaving, leftAt: new Date(), leftReason: input.reason ?? null }
          : { status: "ACTIVE", leftAt: null, leftReason: null },
      });
    }
  });
  if (leaving && student.userId) {
    await ctx.db.student.update({ where: { id: student.id }, data: { accountEnabled: false } });
    await revokeRole(ctx, student.userId, "STUDENT");
  }
  await audit(ctx.db, actor(ctx), {
    action: "student.status",
    entityType: "Student",
    entityId: student.id,
    before: { status: student.status },
    after: { status: input.status, reason: input.reason ?? null },
  });
}

export async function changeClass(ctx: ServiceContext, input: { studentId: string; classId: string }) {
  const year = await requireActiveYear(ctx);
  const enrollment = await found(
    ctx.db.enrollment.findFirst({ where: { studentId: input.studentId, academicYearId: year.id, deletedAt: null } }),
  );
  if (enrollment.classId === input.classId) return;
  await assertClassAvailable(ctx, input.classId, year.id);
  await ctx.db.enrollment.update({ where: { id: enrollment.id }, data: { classId: input.classId } });
  await audit(ctx.db, actor(ctx), {
    action: "student.changeClass",
    entityType: "Student",
    entityId: input.studentId,
    before: { classId: enrollment.classId },
    after: { classId: input.classId },
  });
}

/** Réinscription dans l'année active d'un élève inscrit une année précédente. */
export async function reenrollStudent(ctx: ServiceContext, input: { studentId: string; classId: string }) {
  const student = await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  const year = await requireActiveYear(ctx);
  if (await ctx.db.enrollment.findFirst({ where: { studentId: student.id, academicYearId: year.id } })) {
    throw new DomainError("alreadyEnrolled");
  }
  await assertClassAvailable(ctx, input.classId, year.id);
  await ctx.db.enrollment.create({
    data: {
      schoolId: ctx.school.id,
      studentId: student.id,
      classId: input.classId,
      academicYearId: year.id,
      type: "RE_ENROLLMENT",
    },
  });
  if (student.status !== "ACTIVE") {
    await ctx.db.student.update({ where: { id: student.id }, data: { status: "ACTIVE" } });
  }
  await audit(ctx.db, actor(ctx), {
    action: "student.reenroll",
    entityType: "Student",
    entityId: student.id,
    after: { classId: input.classId, year: year.name },
  });
}

// ── Compte élève ───────────────────────────────────────────────────────────

/**
 * Active le compte élève (identifiant = matricule) et envoie les accès au
 * tuteur principal. Impossible si le niveau n'autorise pas les comptes élèves.
 */
export async function enableStudentAccount(ctx: ServiceContext, studentId: string) {
  const year = await requireActiveYear(ctx);
  const student = await found(
    ctx.db.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: {
        enrollments: { where: { academicYearId: year.id }, include: { class: { include: { level: true } } } },
        guardians: { where: { isPrimary: true }, include: { guardian: { include: { user: true } } } },
      },
    }),
  );
  const level = student.enrollments[0]?.class.level;
  if (level && !level.studentAccounts) throw new DomainError("levelWithoutAccounts");

  const { user, tempPassword } = await ensureUser(ctx, {
    firstName: student.firstName,
    lastName: student.lastName,
    username: student.matricule.toLowerCase(),
  });
  await ctx.db.student.update({ where: { id: student.id }, data: { userId: user.id, accountEnabled: true } });
  await grantRole(ctx, user.id, "STUDENT");

  const password = tempPassword ?? (await resetToTemporaryPassword(ctx, user.id));
  const parent = student.guardians[0]?.guardian.user;
  if (parent) await sendAccess(ctx, user, "student", password, parent);
  await audit(ctx.db, actor(ctx), { action: "student.account.enable", entityType: "Student", entityId: student.id });
  return { username: user.username, temporaryPassword: parent ? null : password };
}

export async function disableStudentAccount(ctx: ServiceContext, studentId: string) {
  const student = await found(ctx.db.student.findFirst({ where: { id: studentId, deletedAt: null } }));
  await ctx.db.student.update({ where: { id: student.id }, data: { accountEnabled: false } });
  if (student.userId) {
    await revokeRole(ctx, student.userId, "STUDENT");
    await ctx.db.session.deleteMany({ where: { userId: student.userId } });
  }
  await audit(ctx.db, actor(ctx), { action: "student.account.disable", entityType: "Student", entityId: student.id });
}

// ── Documents ──────────────────────────────────────────────────────────────

export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function storeDocument(
  ctx: ServiceContext,
  input: { entityType: string; entityId: string; category: string; file: File },
) {
  const ext = DOCUMENT_TYPES[input.file.type];
  if (!ext) throw new DomainError("fileType", "file");
  if (input.file.size > MAX_UPLOAD_BYTES) throw new DomainError("fileTooLarge", "file");
  const key = `schools/${ctx.school.id}/${input.entityType.toLowerCase()}/${input.entityId}/${randomUUID()}.${ext}`;
  await getStorage().put(key, Buffer.from(await input.file.arrayBuffer()), input.file.type);
  return ctx.db.document.create({
    data: {
      schoolId: ctx.school.id,
      entityType: input.entityType,
      entityId: input.entityId,
      category: input.category,
      name: input.file.name.slice(0, 200),
      mimeType: input.file.type,
      size: input.file.size,
      storageKey: key,
      uploadedById: ctx.user.id,
    },
  });
}

export async function uploadStudentDocument(
  ctx: ServiceContext,
  input: { studentId: string; category: string; file: File },
) {
  await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  if (input.category === "PHOTO" && !input.file.type.startsWith("image/")) throw new DomainError("fileType", "file");
  const doc = await storeDocument(ctx, { entityType: "Student", entityId: input.studentId, ...input });
  if (input.category === "PHOTO") {
    await ctx.db.student.update({ where: { id: input.studentId }, data: { photoUrl: `/api/files/${doc.id}` } });
  }
  return doc;
}

export async function deleteDocument(ctx: ServiceContext, id: string) {
  const doc = await found(ctx.db.document.findFirst({ where: { id, deletedAt: null } }));
  await ctx.db.document.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx.db, actor(ctx), { action: "document.delete", entityType: "Document", entityId: id, before: doc });
}
