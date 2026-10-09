import "server-only";
import { prisma } from "@/server/db/client";

/** Vue super admin : toutes les écoles avec abonnement et effectifs. */
export async function listSchoolsForPlatform() {
  const schools = await prisma.school.findMany({
    where: { deletedAt: null },
    include: { subscription: { include: { plan: true } } },
    orderBy: { name: "asc" },
  });
  const counts = await prisma.enrollment.groupBy({
    by: ["schoolId"],
    where: { status: "ACTIVE", deletedAt: null, academicYear: { isActive: true } },
    _count: { _all: true },
  });
  const bySchool = new Map(counts.map((c) => [c.schoolId, c._count._all]));
  return schools.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    city: s.city,
    plan: s.subscription?.plan.name ?? "—",
    status: s.subscription?.status ?? null,
    students: bySchool.get(s.id) ?? 0,
  }));
}
