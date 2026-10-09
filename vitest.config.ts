import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import "dotenv/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // JSX des gabarits PDF (@react-pdf) : transformation automatique, comme Next.js.
  esbuild: { jsx: "automatic" },
  test: {
    // Les tests d'intégration partagent la même base : exécution séquentielle.
    fileParallelism: false,
    // "server-only" lève une erreur hors de Next.js : on le neutralise en test.
    alias: { "server-only": new URL("./tests/server-only.ts", import.meta.url).pathname },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        // Nécessite une base migrée ; le seed est rejoué avant les tests.
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
        },
      },
    ],
  },
});
