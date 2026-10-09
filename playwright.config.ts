import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "fr-FR",
    trace: "retain-on-failure",
    // Permet d'utiliser un Chromium déjà installé (ex. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  // Téléphone Android d'entrée de gamme : l'usage principal des parents.
  projects: [{ name: "mobile", use: { ...devices["Pixel 5"] } }],
  webServer: {
    command: "pnpm start",
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
