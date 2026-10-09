import { expect, test } from "@playwright/test";
import { db } from "./db";
import { login, PASSWORDS } from "./helpers";

test.afterAll(() => db.$disconnect());

const DIRECTOR = "directeur@les-etoiles.lakol.test";

test("inscription d'une école en ligne, puis assistant de démarrage", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  await page.goto("/fr/creer-mon-ecole");
  await page.getByLabel("Nom de l'école").fill(`Groupe Scolaire Kalanso ${suffix}`);
  await page.getByLabel("Ville").fill("Sikasso");
  await page.getByLabel("Prénom").fill("Mariam");
  await page.getByLabel("Nom", { exact: true }).fill("Sangaré");
  await page.getByLabel("Votre téléphone").fill(`76${suffix}`);
  await page.getByLabel("Mot de passe", { exact: true }).fill("Kalanso2026!");
  await page.getByLabel("Confirmer le mot de passe").fill("Kalanso2026!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon école" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId("subscription-banner")).toContainText("Essai gratuit");
  await expect(page.getByTestId("step-school").getByLabel("Terminé")).toBeVisible();

  await page.getByRole("button", { name: "Créer l'année" }).click();
  await expect(page.getByTestId("step-year").getByLabel("Terminé")).toBeVisible();
  await page.getByRole("button", { name: "Créer la structure" }).click();
  await expect(page.getByTestId("step-classes").getByLabel("Terminé")).toBeVisible();

  const school = await db.school.findFirstOrThrow({ where: { name: `Groupe Scolaire Kalanso ${suffix}` } });
  // Fondamental 1er et 2e cycles : 6 + 3 niveaux, une classe chacun.
  expect(await db.class.count({ where: { schoolId: school.id } })).toBe(9);

  await page.goto(`/fr/${school.slug}/dashboard`);
  await expect(page.getByTestId("onboarding-prompt")).toContainText("3 sur 5");
});

test("super admin : facture annuelle, paiement, visible par la direction", async ({ page }) => {
  await login(page, "admin@lakol.test", PASSWORDS.admin);
  await page.goto("/fr/admin/schools?q=Etoiles");
  await page.getByTestId("school-row").first().click();
  await page.getByRole("button", { name: "Émettre la facture annuelle" }).click();
  await expect(page.getByText("Facture émise, la direction est prévenue.")).toBeVisible();
  const invoices = page.getByTestId("admin-invoices");
  await expect(invoices).toContainText("À régler");
  await page.getByLabel("Référence").fill("VIR-2026-001");
  await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(invoices).toContainText("Réglée");

  const invoice = await db.platformInvoice.findFirstOrThrow({
    where: { school: { slug: "les-etoiles" }, status: "PAID" },
    orderBy: { createdAt: "desc" },
  });

  await page.context().clearCookies();
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/subscription");
  await expect(page.getByTestId("school-invoices")).toContainText(invoice.number);
  const pdf = await page.request.get(`/api/platform-invoices/${invoice.id}`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // L'espace plateforme est réservé au super admin ; la facture d'une autre école est introuvable.
  await page.goto("/fr/admin");
  await expect(page.getByTestId("forbidden")).toBeVisible();
  await page.context().clearCookies();
  await login(page, "comptable@les-etoiles.lakol.test", PASSWORDS.staff);
  expect((await page.request.get(`/api/platform-invoices/${invoice.id}`)).status()).toBe(404);
});

test("la direction désactive un module : il disparaît pour toute l'école", async ({ page }) => {
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/subscription");
  const finance = page
    .getByTestId("school-modules")
    .locator("div")
    .filter({ hasText: /^Finances/ });
  page.once("dialog", (d) => d.accept());
  await finance.getByRole("button", { name: "Désactiver" }).click();
  await expect(finance.getByRole("button", { name: "Activer" })).toBeVisible();

  await page.context().clearCookies();
  await login(page, "comptable@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/finance");
  await expect(page.getByTestId("forbidden")).toBeVisible();

  await page.context().clearCookies();
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/subscription");
  await finance.getByRole("button", { name: "Activer" }).click();
  await expect(finance.getByRole("button", { name: "Désactiver" })).toBeVisible();
});
