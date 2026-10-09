import { expect, test } from "@playwright/test";
import { db } from "./db";
import { login, PASSWORDS } from "./helpers";

test.afterAll(() => db.$disconnect());

const today = () => new Date().toISOString().slice(0, 10);

async function class7() {
  return db.class.findFirstOrThrow({ where: { name: "7e A", school: { slug: "les-etoiles" } } });
}

test("parcours 2 : le professeur fait l'appel sur mobile, le parent de l'absent est prévenu", async ({ page }) => {
  const cls = await class7();
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto(`/fr/les-etoiles/attendance/call?classId=${cls.id}&date=${today()}`);

  const row = page.getByTestId("roll-call").locator('button[data-status="PRESENT"]').first();
  const name = (await row.locator("span").first().textContent())!.trim();
  await row.click();
  await expect(page.getByTestId("roll-call").getByRole("button", { name: new RegExp(name) })).toHaveAttribute(
    "data-status",
    "ABSENT",
  );
  await page.getByRole("button", { name: "Valider l'appel" }).click();
  await expect(page.getByText(/Appel enregistré\. \d+ parents? prévenus?\./)).toBeVisible();

  // Le parent est prévenu (WhatsApp tracé) et voit l'absence dans son espace.
  const [lastName, ...rest] = name.split(" ");
  const student = await db.student.findFirstOrThrow({
    where: { lastName, firstName: rest.join(" "), enrollments: { some: { classId: cls.id } } },
    include: { guardians: { include: { guardian: true } } },
  });
  const phone = student.guardians[0].guardian.phone;
  const delivery = await db.notificationDelivery.findFirst({
    where: { recipient: phone, notification: { type: "attendance.absent" } },
  });
  expect(delivery?.status).toBe("SENT");

  await page.context().clearCookies();
  await login(page, phone, PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/attendance");
  await expect(page.getByTestId("family-absence").first()).toBeVisible();
});

test("appel hors connexion : gardé sur le téléphone puis envoyé au retour du réseau", async ({ page, context }) => {
  const cls = await class7();
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto(`/fr/les-etoiles/attendance/call?classId=${cls.id}&date=${today()}`);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Valider l'appel" }).click();
  await expect(page.getByText("Pas de connexion")).toBeVisible();
  await expect(page.getByText("1 appel en attente d'envoi")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("Appels en attente envoyés.")).toBeVisible();
});

test("parcours 3 : le professeur publie un devoir avec pièce jointe ; l'élève le voit et dépose son travail", async ({
  page,
}) => {
  const title = `Problèmes de proportionnalité ${Date.now().toString().slice(-4)}`;
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/homework/new");
  await page.getByLabel("Classe et matière").selectOption({ label: "7e A — Mathématiques" });
  await page.getByLabel("Titre").fill(title);
  await page.getByLabel("Consignes").fill("Résoudre les problèmes 1 à 3.");
  await page
    .getByLabel("Pièces jointes")
    .setInputFiles({ name: "enonce.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.getByLabel("Les élèves déposent leur travail en ligne").check();
  await page.getByRole("button", { name: "Publier le devoir" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("link", { name: "enonce.pdf" })).toBeVisible();

  await page.context().clearCookies();
  await login(page, "ETO-25-0029", "Eleve2025!");
  await page.goto("/fr/les-etoiles/homework");
  await page.getByRole("link", { name: title }).click();
  await page.getByLabel("Votre travail").fill("Problème 1 : 12 kg. Problème 2 : 45 FCFA.");
  await page
    .getByLabel("Pièces jointes")
    .setInputFiles({ name: "ma-copie.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) });
  await page.getByRole("button", { name: "Envoyer mon travail" }).click();
  await expect(page.getByText("Travail envoyé.")).toBeVisible();
  await expect(page.getByText("Rendu", { exact: true })).toBeVisible();

  await page.context().clearCookies();
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/homework");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByTestId("submission-row").filter({ hasText: "Traoré Aminata" })).toContainText("Rendu");
});

test("emploi du temps : un créneau en conflit est refusé", async ({ page }) => {
  const cls = await class7();
  const slot = await db.timetableSlot.findFirstOrThrow({
    where: { classId: cls.id, dayOfWeek: 1 },
    orderBy: { startMin: "asc" },
  });
  await login(page, "secretariat@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto(`/fr/les-etoiles/timetable?classId=${cls.id}&mine=0`);
  await expect(page.getByTestId("timetable-day")).toHaveCount(5);
  await page.getByLabel("Matière").selectOption({ index: 1 });
  await page.getByLabel("Jour").selectOption("1");
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  await page.getByLabel("Début").fill(hhmm(slot.startMin));
  await page.getByLabel("Fin").fill(hhmm(slot.endMin));
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("La classe a déjà un cours sur ce créneau.").first()).toBeVisible();
});

test("le parent justifie une absence, la vie scolaire la valide", async ({ page }) => {
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/attendance");
  const absence = page.getByTestId("family-absence").filter({ hasText: "Justifier cette absence" }).first();
  await absence.getByText("Justifier cette absence").click();
  await absence.getByLabel("Motif").fill("Fièvre, consultation au centre de santé");
  await absence.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Justificatif envoyé à l'école.")).toBeVisible();

  await page.context().clearCookies();
  await login(page, "censeur@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/attendance?pending=1");
  const row = page.getByTestId("absence-row").filter({ hasText: "Fièvre" }).first();
  await row.getByRole("button", { name: "Valider la justification" }).click();
  await expect(page.getByTestId("absence-row").filter({ hasText: "Fièvre" })).toHaveCount(0);
});
