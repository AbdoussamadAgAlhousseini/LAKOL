/* Processus des tâches de fond : envois WhatsApp/email, rappels de devoirs.
 * Lancement : pnpm worker (nécessite REDIS_URL). */
import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { QUEUE_NAME, redisConnection } from "@/server/jobs/queue";
import { runJob, type JobName } from "@/server/jobs/handlers";
import { logger } from "@/server/logger";
import { assertEnv } from "@/server/env";

assertEnv("worker");
if (!process.env.REDIS_URL) {
  logger.error({}, "REDIS_URL manquant : le worker ne peut pas démarrer");
  process.exit(1);
}

const connection = redisConnection();
const queue = new Queue(QUEUE_NAME, { connection });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return runJob(job.name as JobName, job.data, { final });
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, error) =>
  logger.warn({ job: job?.name, attempts: job?.attemptsMade, error: error.message }, "tâche en échec"),
);
worker.on("ready", () => logger.info({ queue: QUEUE_NAME }, "worker prêt"));

// Rappels de devoirs : toutes les heures.
queue
  .upsertJobScheduler("homework-reminders", { pattern: "0 * * * *" }, { name: "homework.reminders", data: {} })
  .catch((error) => logger.error({ error: String(error) }, "planification des rappels impossible"));
// Envois différés (heures calmes) et filet de sécurité : toutes les 10 minutes.
queue
  .upsertJobScheduler("deliveries-flush", { pattern: "*/10 * * * *" }, { name: "deliveries.flush", data: {} })
  .catch((error) => logger.error({ error: String(error) }, "planification des envois impossible"));
// Relances des impayés : chaque jour à 9 h (au plus une par semaine et par élève).
queue
  .upsertJobScheduler("finance-reminders", { pattern: "0 9 * * *" }, { name: "finance.reminders", data: {} })
  .catch((error) => logger.error({ error: String(error) }, "planification des relances impossible"));
// Abonnements : rappels d'essai, renouvellements, impayés, suspensions (chaque nuit).
queue
  .upsertJobScheduler("subscriptions-check", { pattern: "30 2 * * *" }, { name: "subscriptions.check", data: {} })
  .catch((error) => logger.error({ error: String(error) }, "planification des abonnements impossible"));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    await queue.close();
    process.exit(0);
  });
}
