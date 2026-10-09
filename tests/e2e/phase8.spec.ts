import { expect, test } from "@playwright/test";
import { login, PASSWORDS } from "./helpers";

const DIRECTOR = "directeur@les-etoiles.lakol.test";

test("application installable et consultation hors ligne des devoirs", async ({ page, context }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).short_name).toBe("LAKOL");

  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/dashboard");
  // Le service worker contrôle la page après son installation.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r));
  });
  await page.goto("/fr/les-etoiles/homework");
  // Laisse le service worker mettre en cache les scripts de la page.
  await page.waitForFunction(async () => {
    const cache = await caches.open("lakol-static-v1");
    const assets = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.includes("/_next/static/"));
    for (const u of assets) if (!(await cache.match(u))) return false;
    return assets.length > 0;
  });
  const title = await page.getByRole("heading", { level: 1 }).textContent();

  // Coupure réelle : `setOffline` ne s'applique pas toujours au service worker,
  // on bloque donc aussi toutes ses requêtes réseau (voir playwright.config.ts).
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title!);
  await expect(page.getByTestId("offline-banner")).toBeVisible();

  // Une page jamais ouverte affiche la page « hors ligne ».
  await page.goto("/fr/les-etoiles/messages/new");
  await expect(page).toHaveTitle(/Hors ligne/);
  await expect(page.getByRole("heading", { name: "Pas de connexion" })).toBeVisible();
  await context.unroute("**/*");
  await context.setOffline(false);
});

test("direction : alertes, graphiques et export Excel", async ({ page }) => {
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/dashboard");
  await expect(page.getByTestId("alerts")).toContainText("à réapprovisionner");
  await expect(page.getByRole("img", { name: /Moyenne générale par classe/ })).toBeVisible();

  await page.goto("/fr/les-etoiles/students");
  const href = await page.getByTestId("export").getAttribute("href");
  const xlsx = await page.request.get(href!);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
});

test("modules optionnels : la cantine publie un menu, le parent voit menu et bus", async ({ page }) => {
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/canteen");
  const monday = page.getByTestId("menus").locator("form").first();
  await monday.getByLabel("Plat").fill("Couscous de mil au poisson");
  await monday.getByRole("button", { name: "Enregistrer" }).click();
  await expect(monday.getByText("Enregistré.")).toBeVisible();

  await page.context().clearCookies();
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/canteen");
  await expect(page.getByTestId("menus")).toContainText("Couscous de mil au poisson");
  await expect(page.getByTestId("family-canteen")).toContainText("Allergie à l'arachide");
  await page.goto("/fr/les-etoiles/transport");
  await expect(page.getByTestId("family-transport")).toContainText("Circuit Kalaban");

  // Un parent n'accède pas à l'infirmerie ni aux stocks.
  await page.goto("/fr/les-etoiles/infirmary");
  await expect(page.getByTestId("forbidden")).toBeVisible();
});
