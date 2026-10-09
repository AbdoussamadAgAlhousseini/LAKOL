import { expect, test } from "@playwright/test";
import { login, PASSWORDS } from "./helpers";

test("le parent se connecte avec son numéro et voit ses deux enfants", async ({ page }) => {
  await login(page, "70 00 00 01", PASSWORDS.parent);
  await expect(page).toHaveURL(/\/fr\/les-etoiles\/dashboard$/);
  const cards = page.getByTestId("child-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Aminata Traoré" })).toContainText("7e A");
  await expect(cards.filter({ hasText: "Moussa Traoré" })).toContainText("9e A");
  await expect(cards.first()).toContainText("Dernière note");
});

test("mauvais mot de passe : message d'erreur générique", async ({ page }) => {
  await page.goto("/fr/login");
  await page.getByLabel("Téléphone ou email").fill("70000001");
  await page.getByLabel("Mot de passe").fill("incorrect");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Identifiant ou mot de passe incorrect.")).toBeVisible();
});

test("un professeur qui est aussi parent bascule entre ses espaces", async ({ page }) => {
  await login(page, "prof.francais@les-etoiles.lakol.test", PASSWORDS.staff);
  await expect(page).toHaveURL(/\/fr\/spaces$/);
  await page.getByRole("button", { name: /Professeur principal/ }).click();
  await expect(page.getByTestId("active-role").first()).toContainText("Professeur principal");
  await expect(page.getByTestId("teacher-class").first()).toBeVisible();

  await page.goto("/fr/spaces");
  await page.getByRole("button", { name: /Parent/ }).click();
  await expect(page.getByTestId("active-role").first()).toContainText("Parent");
  await expect(page.getByTestId("child-card")).toHaveCount(1);
});

test("un professeur n'accède pas aux finances", async ({ page }) => {
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/finance");
  await expect(page.getByTestId("forbidden")).toBeVisible();
});

test("un utilisateur de l'école A n'accède pas à l'école B", async ({ page }) => {
  await login(page, "directeur@les-etoiles.lakol.test", PASSWORDS.staff);
  await expect(page).toHaveURL(/\/les-etoiles\/dashboard$/);
  await page.goto("/fr/le-savoir/dashboard");
  await expect(page.getByTestId("forbidden")).toBeVisible();
});

test("le super admin voit toutes les écoles", async ({ page }) => {
  await login(page, "admin@lakol.test", PASSWORDS.admin);
  await page.getByRole("link", { name: /Administration de la plateforme/ }).click();
  await expect(page.getByRole("cell", { name: /Complexe Scolaire Les Étoiles/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /École Le Savoir/ })).toBeVisible();
});

test("une page protégée redirige vers la connexion", async ({ page }) => {
  await page.goto("/fr/les-etoiles/dashboard");
  await expect(page).toHaveURL(/\/fr\/login$/);
});
