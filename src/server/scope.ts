import type { TenantDb } from "@/server/db/tenant";

/** Périmètre `:own` selon l'espace actif. */
export async function loadScope(db: TenantDb, userId: string, roleKey: string) {
  const classIds = new Set<string>();
  const studentIds = new Set<string>();
  let staffId: string | null = null;

  const activeYear = await db.academicYear.findFirst({ where: { isActive: true }, select: { id: true } });

  if (roleKey === "TEACHER" || roleKey === "HEAD_TEACHER") {
    const staff = await db.staff.findFirst({ where: { userId, deletedAt: null }, select: { id: true } });
    if (staff && activeYear) {
      staffId = staff.id;
      const [assignments, headed] = await Promise.all([
        db.teachingAssignment.findMany({
          where: { staffId: staff.id, academicYearId: activeYear.id },
          select: { classId: true },
        }),
        db.class.findMany({ where: { headTeacherId: staff.id, academicYearId: activeYear.id }, select: { id: true } }),
      ]);
      assignments.forEach((a) => classIds.add(a.classId));
      headed.forEach((c) => classIds.add(c.id));
      const enrolled = await db.enrollment.findMany({
        where: { classId: { in: [...classIds] }, status: "ACTIVE", deletedAt: null },
        select: { studentId: true },
      });
      enrolled.forEach((e) => studentIds.add(e.studentId));
    }
  } else if (roleKey === "PARENT") {
    const links = await db.studentGuardian.findMany({
      where: { guardian: { userId, deletedAt: null }, student: { deletedAt: null } },
      select: { studentId: true },
    });
    links.forEach((l) => studentIds.add(l.studentId));
  } else if (roleKey === "STUDENT") {
    const student = await db.student.findFirst({
      where: { userId, accountEnabled: true, deletedAt: null },
      select: { id: true },
    });
    if (student) studentIds.add(student.id);
  } else {
    const staff = await db.staff.findFirst({ where: { userId, deletedAt: null }, select: { id: true } });
    staffId = staff?.id ?? null;
  }

  return { classIds, studentIds, staffId };
}
