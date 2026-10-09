import { expect, test } from "@playwright/test";
import { db, lastMessageTo } from "./db";
import { login, PASSWORDS } from "./helpers";

test.afterAll(() => db.$disconnect());

test("le secrétariat inscrit un élève ; le parent reçoit ses accès et se connecte", async ({ page }) => {
  const phone = `7${Date.now().toString().slice(-7)}`;
  await login(page, "secretariat@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/students/new");
  await page.getByLabel("Nom").first().fill("Konaté");
  await page.getByLabel("Prénom").first().fill("Assitan");
  await page.getByLabel("Sexe").selectOption("FEMALE");
  await page.getByLabel("Date de naissance").fill("2013-09-14");
  await page.getByLabel("Classe").selectOption({ label: "7e A" });
  await page.locator("#g1LastName").fill("Konaté");
  await page.locator("#g1FirstName").fill("Lassana");
  await page.locator("#g1Phone").fill(phone);
  await page.locator("#g1Relationship").selectOption("FATHER");
  await page.getByRole("button", { name: "Inscrire l'élève" }).click();

  await expect(page.getByRole("heading", { name: "Assitan Konaté" })).toBeVisible();
  await expect(page.getByTestId("guardian")).toContainText("Lassana Konaté");

  // Le message WhatsApp (simulé) contient le mot de passe provisoire.
  const message = await lastMessageTo(`+223${phone}`);
  const password = message!.match(/provisoire : (\S+)/)![1];

  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel("Téléphone ou email").fill(phone);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Première connexion : changement de mot de passe obligatoire.
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.getByLabel("Mot de passe provisoire").fill(password);
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("MonEnfant2025");
  await page.getByLabel("Confirmez le nouveau mot de passe").fill("MonEnfant2025");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page).toHaveURL(/\/les-etoiles\/dashboard$/);
  await expect(page.getByTestId("child-card")).toContainText("Assitan Konaté");
});

test("parcours 6 : un professeur n'ouvre pas une classe qui n'est pas la sienne", async ({ page }) => {
  const english = await db.staff.findFirstOrThrow({ where: { lastName: "Mensah" }, include: { user: true } });
  const other = await db.class.findFirstOrThrow({ where: { name: "5e A", school: { slug: "les-etoiles" } } });
  const own = await db.class.findFirstOrThrow({ where: { name: "7e A", school: { slug: "les-etoiles" } } });

  await login(page, english.user!.phone!, PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/classes");
  await expect(page.getByTestId("class-card")).toHaveCount(3);

  await page.goto(`/fr/les-etoiles/classes/${own.id}`);
  await expect(page.getByTestId("roster").locator("li").first()).toBeVisible();

  await page.goto(`/fr/les-etoiles/classes/${other.id}`);
  await expect(page.getByTestId("forbidden")).toBeVisible();
  await page.goto("/fr/les-etoiles/structure");
  await expect(page.getByTestId("forbidden")).toBeVisible();
});

test("import d'une classe depuis un fichier CSV", async ({ page }) => {
  const csv = [
    "nom;prenom;sexe;date_naissance;lieu_naissance;classe;parent_nom;parent_prenom;parent_telephone;parent_email;lien",
    `Sow;Hawa;F;01/02/2012;Kayes;9e A;Sow;Bakary;6${Date.now().toString().slice(-7)};;Père`,
    `Sow;Oumar;M;01/02/2010;Kayes;11e TSE;Sow;Bakary;6${Date.now().toString().slice(-7)};;Père`,
  ].join("\n");
  await login(page, "secretariat@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/students/import");
  await page
    .getByLabel("Fichier Excel (.xlsx) ou CSV")
    .setInputFiles({ name: "eleves.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(page.getByText("2 lignes valides")).toBeVisible();
  await page.getByRole("button", { name: "Importer 2 élèves" }).click();
  await expect(page.getByText("2 élèves importés.")).toBeVisible();

  await page.goto("/fr/les-etoiles/students?q=Sow");
  await expect(page.getByTestId("student-row")).toHaveCount(2);
});

test("pré-inscription publique puis validation par l'école", async ({ page }) => {
  await page.goto("/fr/inscription/les-etoiles");
  await page.getByLabel("Nom").first().fill("Maïga");
  await page.getByLabel("Prénom").first().fill("Fatoumata");
  await page.getByLabel("Sexe").selectOption("FEMALE");
  await page.getByLabel("Classe souhaitée").selectOption({ label: "9e année" });
  await page.locator("#guardianLastName").fill("Maïga");
  await page.locator("#guardianFirstName").fill("Ibrahim");
  await page.locator("#guardianPhone").fill(`66${Date.now().toString().slice(-6)}`);
  await page.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(page.getByText("Demande envoyée")).toBeVisible();

  await login(page, "secretariat@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/students/pre-registrations");
  const card = page
    .locator("div")
    .filter({ hasText: "Fatoumata Maïga" })
    .filter({ has: page.getByRole("button", { name: "Valider et inscrire" }) })
    .last();
  await card.getByRole("button", { name: "Valider et inscrire" }).click();
  await expect(page.getByRole("heading", { name: "Fatoumata Maïga" })).toBeVisible();
});

test("l'élève se connecte avec son matricule", async ({ page }) => {
  await login(page, "ETO-25-0029", "Eleve2025!");
  await expect(page).toHaveURL(/\/les-etoiles\/dashboard$/);
  await expect(page.getByTestId("child-card")).toContainText("Aminata Traoré");
});

test("la direction crée une classe et affecte un professeur", async ({ page }) => {
  const name = `8e B${Date.now().toString().slice(-3)}`;
  await login(page, "directeur@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/structure?tab=classes");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Créer" }) });
  await form.getByLabel("Nom de la classe").fill(name);
  await form.getByLabel("Niveau").selectOption({ label: "7e année" });
  await form.getByRole("button", { name: "Créer" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/classes\/[a-z0-9]+$/);
  await page.getByLabel("Matière").selectOption({ label: "Mathématiques" });
  await page.getByLabel("Professeur").selectOption({ label: "Abdoulaye Sissoko" });
  await page.getByRole("button", { name: "Affecter" }).click();
  await expect(page.getByRole("cell", { name: "Abdoulaye Sissoko" })).toBeVisible();
});
