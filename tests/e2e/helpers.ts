import { expect, type Page } from "@playwright/test";

export const PASSWORDS = { parent: "Parent2025!", staff: "Lakol2025!", admin: "Admin2025!" };

export async function login(page: Page, identifier: string, password: string) {
  await page.goto("/fr/login");
  await page.getByLabel("Téléphone ou email").fill(identifier);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
