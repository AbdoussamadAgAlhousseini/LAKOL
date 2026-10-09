import "server-only";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import { addDays, weekStart } from "@/lib/time";
import type { ServiceContext } from "../context";
import { found, requireActiveYear } from "../structure";

function requireManager(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "canteen.manage")) throw new ForbiddenError();
}

/** Inscrits de l'année, par classe. */
export async function listCanteenSubscribers(ctx: ServiceContext) {
  requireManager(ctx);
  const year = await requireActiveYear(ctx);
  const subs = await ctx.db.canteenSubscription.findMany({
    where: { academicYearId: year.id, endDate: null },
    include: {
      student: {
        include: { enrollments: { where: { academicYearId: year.id, status: "ACTIVE" }, include: { class: true } } },
      },
    },
    orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  });
  return subs.map((s) => ({ ...s, className: s.student.enrollments[0]?.class.name ?? "—" }));
}

export async function subscribeCanteen(ctx: ServiceContext, input: { studentId: string; dietNotes?: string | null }) {
  requireManager(ctx);
  const year = await requireActiveYear(ctx);
  await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  return ctx.db.canteenSubscription.upsert({
    where: { studentId_academicYearId: { studentId: input.studentId, academicYearId: year.id } },
    create: {
      schoolId: ctx.school.id,
      studentId: input.studentId,
      academicYearId: year.id,
      dietNotes: input.dietNotes ?? null,
      startDate: new Date(),
    },
    update: { dietNotes: input.dietNotes ?? null, endDate: null },
  });
}

export async function unsubscribeCanteen(ctx: ServiceContext, id: string) {
  requireManager(ctx);
  await found(ctx.db.canteenSubscription.findUnique({ where: { id } }));
  await ctx.db.canteenSubscription.update({ where: { id }, data: { endDate: new Date() } });
}

/** Menus de la semaine (lundi à vendredi). */
export async function weekMenus(ctx: ServiceContext, from = weekStart()) {
  if (!canAll(ctx.scope, "canteen.manage") && !ctx.scope.permissions.has("canteen.read:own"))
    throw new ForbiddenError();
  const days = Array.from({ length: 5 }, (_, i) => addDays(from, i));
  const menus = await ctx.db.canteenMenu.findMany({ where: { date: { gte: days[0], lte: days[4] } } });
  return days.map((day) => ({
    day,
    menu: menus.find((m) => m.date.getTime() === day.getTime()) ?? null,
  }));
}

export async function saveMenu(ctx: ServiceContext, input: { date: Date; meal: string; notes?: string | null }) {
  requireManager(ctx);
  if (!input.meal.trim()) throw new DomainError("invalid", "meal");
  return ctx.db.canteenMenu.upsert({
    where: { schoolId_date: { schoolId: ctx.school.id, date: input.date } },
    create: { schoolId: ctx.school.id, date: input.date, meal: input.meal, notes: input.notes ?? null },
    update: { meal: input.meal, notes: input.notes ?? null },
  });
}

/** Famille : enfants inscrits à la cantine (et régime noté). */
export async function familyCanteen(ctx: ServiceContext) {
  const year = await requireActiveYear(ctx);
  const ids = [...ctx.scope.studentIds];
  ids.forEach((id) => requireStudentAccess(ctx.scope, "canteen.read", id));
  const students = await ctx.db.student.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: { canteenSubs: { where: { academicYearId: year.id, endDate: null } } },
    orderBy: { firstName: "asc" },
  });
  return students.map((s) => ({
    id: s.id,
    name: s.firstName,
    subscribed: s.canteenSubs.length > 0,
    diet: s.canteenSubs[0]?.dietNotes ?? null,
  }));
}
