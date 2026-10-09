import { execSync } from "node:child_process";

// Données de démonstration fraîches avant chaque exécution.
export default function setup() {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
}
