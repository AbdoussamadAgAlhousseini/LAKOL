import type { Prisma } from "@prisma/client";

/**
 * Incrémente atomiquement un compteur d'école et renvoie la nouvelle valeur.
 * À appeler dans la transaction qui crée l'objet numéroté (pas de trou ni de doublon).
 */
export async function nextSequence(
  tx: Pick<Prisma.TransactionClient, "counter">,
  schoolId: string,
  key: string,
): Promise<number> {
  const counter = await tx.counter.upsert({
    where: { schoolId_key: { schoolId, key } },
    create: { schoolId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}
