import type { Counter, Prisma } from "@prisma/client";

/** Tout client exposant `counter.upsert` : client brut, client d'école ou transaction. */
interface CounterClient {
  counter: { upsert(args: Prisma.CounterUpsertArgs): PromiseLike<Counter> };
}

/**
 * Incrémente atomiquement un compteur d'école et renvoie la nouvelle valeur.
 * À appeler dans la transaction qui crée l'objet numéroté (pas de trou ni de doublon).
 */
export async function nextSequence(tx: CounterClient, schoolId: string, key: string): Promise<number> {
  const counter = await tx.counter.upsert({
    where: { schoolId_key: { schoolId, key } },
    create: { schoolId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}
