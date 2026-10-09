import { expect, test } from "@playwright/test";
import { db } from "./db";
import { login, PASSWORDS } from "./helpers";

test.afterAll(() => db.$disconnect());

const TEACHER = "prof.maths@les-etoiles.lakol.test";
const DIRECTOR = "directeur@les-etoiles.lakol.test";

test("messagerie : le parent écrit au professeur, qui répond", async ({ page }) => {
  const text = `Question sur l'exercice ${Date.now()}`;
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/messages/new");
  await page
    .getByTestId("contacts")
    .getByRole("link")
    .filter({ hasText: /Professeur de Mathématiques — Aminata/ })
    .first()
    .click();
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page).toHaveURL(/\/messages\/c/);
  await expect(page.getByTestId("thread")).toContainText(text);

  // Le professeur voit le message non lu et répond.
  await page.context().clearCookies();
  await login(page, TEACHER, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/messages");
  await expect(page.getByTestId("messages-count")).toBeVisible();
  await page.getByTestId("conversation").filter({ hasText: text }).click();
  await expect(page.getByTestId("thread")).toContainText(text);
  await page.getByLabel("Message", { exact: true }).fill("Je reprends l'exercice demain en classe.");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByTestId("thread")).toContainText("Je reprends l'exercice demain en classe.");

  // Un parent ne peut pas ouvrir la conversation d'un autre.
  const conversationUrl = page.url();
  await page.context().clearCookies();
  await login(page, "70000002", PASSWORDS.parent);
  await page.goto(conversationUrl);
  await expect(page.getByTestId("forbidden")).toBeVisible();
});

test("circulaire : publiée à une classe, le parent confirme la lecture, la direction suit", async ({ page }) => {
  const title = `Sortie scolaire ${Date.now()}`;
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/announcements");
  await page.getByLabel("Titre").fill(title);
  await page.getByLabel("Texte").fill("La classe visitera le musée national jeudi. Merci de confirmer.");
  await page.getByLabel("Destinataires").selectOption("CLASS");
  await page.getByLabel("7e A").check();
  await page.getByLabel("Circulaire : demander un accusé de lecture").check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page).toHaveURL(/\/announcements\/c/);
  const url = page.url();
  await expect(page.getByTestId("announcement-stats")).toContainText("Destinataires");

  await page.context().clearCookies();
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/announcements");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "J'ai lu cette circulaire" }).click();
  await expect(page.getByTestId("acked")).toBeVisible();

  await page.context().clearCookies();
  await login(page, DIRECTOR, PASSWORDS.staff);
  await page.goto(url);
  await expect(page.getByTestId("announcement-stats")).toContainText(/Accusés de lecture\s*1/);
});

test("rendez-vous : le parent réserve un créneau, le professeur le voit", async ({ page }) => {
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/meetings");
  const card = page.getByTestId("teacher-slots").filter({ hasText: "Mathématiques" }).first();
  await card.getByLabel("Motif (facultatif)").fill("Résultats du trimestre");
  await card.getByRole("button", { name: "Réserver" }).click();
  await expect(page.getByTestId("my-bookings")).toBeVisible();

  await page.context().clearCookies();
  await login(page, TEACHER, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/meetings");
  await expect(page.getByTestId("slot").filter({ hasText: "Réservé" }).first()).toContainText("Résultats du trimestre");

  // Un professeur n'a pas accès à la modération ni au suivi des envois.
  await page.goto("/fr/les-etoiles/messages/moderation");
  await expect(page.getByTestId("forbidden")).toBeVisible();
  await page.goto("/fr/les-etoiles/announcements/deliveries");
  await expect(page.getByTestId("forbidden")).toBeVisible();
});
