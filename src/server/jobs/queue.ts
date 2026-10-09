import { Queue } from "bullmq";
import { logger } from "@/server/logger";
import { runJob, type JobData, type JobName } from "./handlers";

export const QUEUE_NAME = "lakol";

let queue: Queue | undefined;

export function redisConnection() {
  const url = new URL(process.env.REDIS_URL!);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

/** Exécution immédiate (sans Redis) : développement simple et tests. */
export function jobsInline() {
  return !process.env.REDIS_URL || process.env.JOBS_INLINE === "1";
}

/**
 * Met une tâche en file (envois WhatsApp/email, rappels…). Sans Redis, la
 * tâche s'exécute tout de suite ; une erreur est alors journalisée sans
 * interrompre l'action de l'utilisateur.
 */
export async function enqueue<N extends JobName>(name: N, data: JobData[N]) {
  if (jobsInline()) {
    try {
      await runJob(name, data, { final: true });
    } catch (error) {
      logger.error({ job: name, error: String(error) }, "tâche en échec");
    }
    return;
  }
  queue ??= new Queue(QUEUE_NAME, { connection: redisConnection() });
  await queue.add(name, data, {
    attempts: 4,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
