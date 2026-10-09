import { execSync } from "node:child_process";

// Chaque exécution part des mêmes données : la base est réinitialisée par le seed.
export default function setup() {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
}
