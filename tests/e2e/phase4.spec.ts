import { expect, test } from "@playwright/test";
import { db } from "./db";
import { login, PASSWORDS } from "./helpers";

test.afterAll(() => db.$disconnect());

test("parcours 4 : notes saisies, validées, bulletin PDF publié et visible par le parent", async ({ page }) => {
  const term = await db.term.findFirstOrThrow({
    where: { order: 3, academicYear: { isActive: true, school: { slug: "les-etoiles" } } },
  });
  const title = `Composition T3 ${Date.now().toString().slice(-4)}`;

  // 1. Le professeur crée l'évaluation et saisit les notes au clavier (Entrée = élève suivant).
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto(`/fr/les-etoiles/grades?term=${term.id}`);
  await page.getByLabel("Classe et matière").selectOption({ label: "7e A — Mathématiques" });
  await page.getByLabel("Type").selectOption("COMPOSITION");
  await page.getByLabel("Intitulé").fill(title);
  await page.getByRole("button", { name: "Créer et saisir les notes" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  const inputs = page.getByTestId("grade-grid").locator("input");
  const count = await inputs.count();
  await inputs.first().click();
  for (let i = 0; i < count; i++) {
    await page.keyboard.type(i === 1 ? "abs" : `${11 + (i % 8)},5`);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText(`${count}/${count} notes saisies`)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.getByText("Enregistré.")).toBeVisible();

  // 2. La direction valide, édite et publie.
  await page.context().clearCookies();
  await login(page, "directeur@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto(`/fr/les-etoiles/report-cards?term=${term.id}`);
  const row = page.getByTestId("report-class").filter({ hasText: "7e A" });
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Valider les notes" }).click();
  await expect(row.getByRole("button", { name: "Éditer les bulletins" })).toBeVisible();
  await row.getByRole("button", { name: "Éditer les bulletins" }).click();
  await expect(row.getByRole("button", { name: "Publier aux parents" })).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Publier aux parents" }).click();
  await expect(row.getByText("Publiés")).toBeVisible();

  // 3. Le parent voit et télécharge le bulletin.
  await page.context().clearCookies();
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/report-cards");
  const card = page.getByTestId("family-report-card").filter({ hasText: "Aminata" }).filter({ hasText: term.name });
  await expect(card).toBeVisible();
  const href = await card.getByRole("link", { name: "Télécharger (PDF)" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Notes visibles dans l'espace parent.
  await page.goto(`/fr/les-etoiles/grades?term=${term.id}`);
  await expect(page.getByTestId("family-grades").filter({ hasText: "Aminata" })).toContainText("Mathématiques");
});

test("un professeur ne peut pas modifier des notes validées", async ({ page }) => {
  const assessment = await db.assessment.findFirstOrThrow({
    where: { isLocked: true, class: { name: "7e A" }, subject: { code: "MATH" } },
  });
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto(`/fr/les-etoiles/grades/${assessment.id}`);
  await expect(page.getByText("Notes validées par la direction")).toBeVisible();
  await expect(page.getByTestId("grade-grid").locator("input").first()).toBeDisabled();
});
