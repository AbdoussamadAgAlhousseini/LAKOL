import "server-only";
import type { Gender, GuardianRelationship } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { forSchool } from "@/server/db/tenant";
import { DomainError } from "@/server/errors";

const MAX_PER_IP_PER_HOUR = 10;

/** Données publiques nécessaires au formulaire de pré-inscription. */
export async function getPublicSchool(slug: string) {
  const school = await prisma.school.findFirst({ where: { slug, isActive: true, deletedAt: null } });
  if (!school) return null;
  const levels = await forSchool(school.id).level.findMany({
    include: { cycle: true },
    orderBy: [{ cycle: { order: "asc" } }, { order: "asc" }],
  });
  return { school, levels };
}

export interface PreRegistrationInput {
  levelId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate?: Date | null;
  birthPlace?: string | null;
  previousSchool?: string | null;
  guardianFirstName: string;
  guardianLastName: string;
  guardianPhone: string;
  guardianEmail?: string | null;
  guardianRelation: GuardianRelationship;
  notes?: string | null;
}

/** Formulaire public : limité en nombre par adresse IP. */
export async function submitPreRegistration(slug: string, input: PreRegistrationInput, ip: string | null) {
  const school = await prisma.school.findFirst({ where: { slug, isActive: true, deletedAt: null } });
  if (!school) throw new DomainError("notFound");
  if (ip) {
    const recent = await prisma.preRegistration.count({
      where: { ip, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= MAX_PER_IP_PER_HOUR) throw new DomainError("tooManyRequests");
  }
  const db = forSchool(school.id);
  const level = await db.level.findUnique({ where: { id: input.levelId } });
  if (!level) throw new DomainError("notFound", "levelId");
  return db.preRegistration.create({ data: { schoolId: school.id, ...input, ip } });
}
