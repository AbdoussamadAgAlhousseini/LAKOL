import { Prisma } from "@prisma/client";
import { prisma } from "./client";

/** Modèles sans `schoolId` : jamais filtrés par école. */
export const GLOBAL_MODELS = new Set<string>([
  "Plan",
  "School",
  "User",
  "Session",
  "VerificationCode",
  "LoginAttempt",
  "Permission",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolationError";
  }
}

type Args = Record<string, unknown>;

function assertNoForeignSchool(data: unknown, schoolId: string, model: string) {
  if (data && typeof data === "object" && "schoolId" in data) {
    const value = (data as Args).schoolId;
    if (value !== undefined && value !== schoolId) {
      throw new TenantViolationError(`${model}: schoolId étranger refusé`);
    }
  }
}

/**
 * Applique le filtre d'école à une opération Prisma. Exportée pour les tests.
 * Limite connue : les écritures imbriquées (create dans un create) ne sont
 * pas réécrites ; les services doivent les éviter ou fournir `schoolId`.
 */
export function scopeArgs(model: string, operation: string, args: Args, schoolId: string): Args {
  if (GLOBAL_MODELS.has(model)) return args;
  const next: Args = { ...args };

  if (WHERE_OPERATIONS.has(operation)) {
    next.where = { ...((args.where as Args | undefined) ?? {}), schoolId };
  }

  switch (operation) {
    case "create":
      assertNoForeignSchool(args.data, schoolId, model);
      next.data = { ...(args.data as Args), schoolId };
      break;
    case "createMany":
    case "createManyAndReturn": {
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      rows.forEach((row) => assertNoForeignSchool(row, schoolId, model));
      next.data = rows.map((row) => ({ ...(row as Args), schoolId }));
      break;
    }
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      assertNoForeignSchool(args.data, schoolId, model);
      break;
    case "upsert":
      assertNoForeignSchool(args.create, schoolId, model);
      assertNoForeignSchool(args.update, schoolId, model);
      next.create = { ...(args.create as Args), schoolId };
      break;
  }
  return next;
}

/**
 * Client Prisma limité à une école : toutes les lectures et écritures sur les
 * modèles métier sont automatiquement filtrées par `schoolId`.
 */
export function forSchool(schoolId: string) {
  if (!schoolId) throw new TenantViolationError("schoolId manquant");
  return prisma.$extends({
    name: "tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, (args ?? {}) as Args, schoolId) as never);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forSchool>;
export type { Prisma };
