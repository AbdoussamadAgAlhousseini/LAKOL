import "server-only";
import type { ServiceContext } from "./context";
import { getActiveYear } from "./structure";

/** Listes de choix des formulaires (année active). */
export async function classOptions(ctx: ServiceContext) {
  const year = await getActiveYear(ctx);
  if (!year) return [];
  const classes = await ctx.db.class.findMany({
    where: { academicYearId: year.id },
    include: { level: true },
    orderBy: [{ level: { order: "asc" } }, { name: "asc" }],
  });
  return classes.map((c) => ({ id: c.id, name: c.name, levelId: c.levelId, level: c.level.name }));
}

export async function staffOptions(ctx: ServiceContext) {
  const staff = await ctx.db.staff.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return staff.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, position: s.position }));
}

export async function subjectOptions(ctx: ServiceContext) {
  const subjects = await ctx.db.subject.findMany({ orderBy: { name: "asc" } });
  return subjects.map((s) => ({ id: s.id, name: s.name, code: s.code }));
}
