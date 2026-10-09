/* Exécute une tâche à la main (ex. pnpm jobs:reminders), utile sans Redis ou en cron système. */
import "dotenv/config";
import { runJob, type JobName } from "@/server/jobs/handlers";
import { prisma } from "@/server/db/client";

const name = process.argv[2] as JobName;
runJob(name, {} as never, { final: true })
  .then((result) => console.log(name, result ?? "ok"))
  .finally(() => prisma.$disconnect());
