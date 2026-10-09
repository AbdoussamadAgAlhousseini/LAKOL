import "server-only";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError, requireStudentAccess } from "@/server/rbac/policies";
import type { ServiceContext } from "../context";
import { found, requireActiveYear } from "../structure";

function requireManager(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "transport.manage")) throw new ForbiddenError();
}

/** Circuits avec arrêts, chauffeur et élèves transportés (année active). */
export async function listRoutes(ctx: ServiceContext) {
  requireManager(ctx);
  const year = await requireActiveYear(ctx);
  return ctx.db.busRoute.findMany({
    include: {
      driver: true,
      stops: { orderBy: { order: "asc" } },
      assignments: {
        where: { academicYearId: year.id },
        include: { student: true, stop: true },
        orderBy: { student: { lastName: "asc" } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function saveRoute(
  ctx: ServiceContext,
  input: {
    id?: string;
    name: string;
    vehicle?: string | null;
    capacity?: number | null;
    driverStaffId?: string | null;
  },
) {
  requireManager(ctx);
  if (input.driverStaffId) await found(ctx.db.staff.findUnique({ where: { id: input.driverStaffId } }));
  const data = {
    name: input.name,
    vehicle: input.vehicle ?? null,
    capacity: input.capacity ?? null,
    driverStaffId: input.driverStaffId ?? null,
  };
  if (input.id) {
    await found(ctx.db.busRoute.findUnique({ where: { id: input.id } }));
    return ctx.db.busRoute.update({ where: { id: input.id }, data });
  }
  return ctx.db.busRoute.create({ data: { schoolId: ctx.school.id, ...data } });
}

export async function deleteRoute(ctx: ServiceContext, id: string) {
  requireManager(ctx);
  await found(ctx.db.busRoute.findUnique({ where: { id } }));
  await ctx.db.busRoute.delete({ where: { id } });
}

export async function addStop(
  ctx: ServiceContext,
  input: { routeId: string; name: string; pickupMin?: number | null; dropoffMin?: number | null },
) {
  requireManager(ctx);
  await found(ctx.db.busRoute.findUnique({ where: { id: input.routeId } }));
  const order = await ctx.db.busStop.count({ where: { routeId: input.routeId } });
  return ctx.db.busStop.create({
    data: {
      schoolId: ctx.school.id,
      routeId: input.routeId,
      name: input.name,
      order: order + 1,
      pickupMin: input.pickupMin ?? null,
      dropoffMin: input.dropoffMin ?? null,
    },
  });
}

export async function deleteStop(ctx: ServiceContext, id: string) {
  requireManager(ctx);
  await found(ctx.db.busStop.findUnique({ where: { id } }));
  await ctx.db.busStop.delete({ where: { id } });
}

/** Affecte un élève à un circuit (et un arrêt) pour l'année ; capacité du véhicule respectée. */
export async function assignStudent(
  ctx: ServiceContext,
  input: { studentId: string; routeId: string; stopId?: string | null },
) {
  requireManager(ctx);
  const year = await requireActiveYear(ctx);
  const route = await found(ctx.db.busRoute.findUnique({ where: { id: input.routeId } }));
  await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  if (input.stopId) {
    const stop = await found(ctx.db.busStop.findUnique({ where: { id: input.stopId } }));
    if (stop.routeId !== route.id) throw new DomainError("invalid", "stopId");
  }
  if (route.capacity) {
    const count = await ctx.db.transportAssignment.count({
      where: { routeId: route.id, academicYearId: year.id, NOT: { studentId: input.studentId } },
    });
    if (count >= route.capacity) throw new DomainError("busFull", "routeId");
  }
  return ctx.db.transportAssignment.upsert({
    where: { studentId_academicYearId: { studentId: input.studentId, academicYearId: year.id } },
    create: {
      schoolId: ctx.school.id,
      studentId: input.studentId,
      academicYearId: year.id,
      routeId: route.id,
      stopId: input.stopId ?? null,
    },
    update: { routeId: route.id, stopId: input.stopId ?? null },
  });
}

export async function unassignStudent(ctx: ServiceContext, id: string) {
  requireManager(ctx);
  await found(ctx.db.transportAssignment.findUnique({ where: { id } }));
  await ctx.db.transportAssignment.delete({ where: { id } });
}

/** Famille : circuit, arrêt et horaires de chaque enfant transporté. */
export async function familyTransport(ctx: ServiceContext) {
  const year = await requireActiveYear(ctx);
  const ids = [...ctx.scope.studentIds];
  ids.forEach((id) => requireStudentAccess(ctx.scope, "transport.read", id));
  const students = await ctx.db.student.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      transport: {
        where: { academicYearId: year.id },
        include: { route: { include: { driver: true } }, stop: true },
      },
    },
    orderBy: { firstName: "asc" },
  });
  return students.map((s) => ({ id: s.id, name: s.firstName, assignment: s.transport[0] ?? null }));
}
