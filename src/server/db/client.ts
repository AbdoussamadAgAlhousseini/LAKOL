import { PrismaClient } from "@prisma/client";

// Client « brut », sans filtre d'école. Son import est limité par ESLint à
// src/server/db, src/server/auth et src/server/platform : le reste du code
// passe par `forSchool()` (voir tenant.ts).

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "test" ? [] : process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
