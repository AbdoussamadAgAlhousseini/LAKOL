import { expect, test } from "@playwright/test";
import { formatMoney } from "@/lib/money";
import { db } from "./db";
import { login, PASSWORDS } from "./helpers";

test.afterAll(() => db.$disconnect());

const normalize = (s: string) => s.replace(/[\s  ]/g, " ").trim();

async function balanceOf(studentId: string) {
  const sums = await db.invoice.aggregate({
    where: { studentId, status: { not: "CANCELLED" }, deletedAt: null, academicYear: { isActive: true } },
    _sum: { total: true, amountPaid: true },
  });
  return (sums._sum.total ?? 0) - (sums._sum.amountPaid ?? 0);
}

test("parcours 5 : paiement en espèces, reçu PDF, solde du parent mis à jour", async ({ page }) => {
  const aminata = await db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0029" } });
  const before = await balanceOf(aminata.id);

  await login(page, "comptable@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/finance/accounts?q=Aminata");
  await page.getByTestId("account-row").filter({ hasText: "Traoré" }).first().click();
  await expect(page.getByRole("heading", { name: "Aminata Traoré" })).toBeVisible();
  await page.locator("#amount").fill("10 000");
  await page.getByLabel("Mode de paiement").selectOption("CASH");
  await page.getByRole("button", { name: "Enregistrer et éditer le reçu" }).click();
  await expect(page.getByText("Paiement enregistré, reçu édité.")).toBeVisible();

  const receipt = page
    .getByTestId("payment-row")
    .first()
    .getByRole("link", { name: /Reçu REC-/ });
  const href = await receipt.getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(await balanceOf(aminata.id)).toBe(before - 10000);

  // Le parent voit le nouveau solde et peut ouvrir le reçu.
  await page.context().clearCookies();
  await login(page, "70000001", PASSWORDS.parent);
  await page.goto("/fr/les-etoiles/finance");
  const account = page.getByTestId("family-account").filter({ hasText: "Aminata" });
  await expect(account.getByTestId("account-balance")).toHaveText(
    new RegExp(normalize(formatMoney(before - 10000, "XOF", "fr")).replace(/ /g, "\\s")),
  );
  const parentReceipt = await account
    .getByRole("link", { name: /Reçu REC-/ })
    .first()
    .getAttribute("href");
  expect((await page.request.get(parentReceipt!)).status()).toBe(200);

  // Un parent n'ouvre pas le reçu d'un autre élève.
  const other = await db.payment.findFirstOrThrow({ where: { student: { matricule: "ETO-25-0001" } } });
  expect((await page.request.get(`/api/schools/les-etoiles/receipts/${other.id}`)).status()).toBe(403);
});

test("la comptabilité relance un impayé et clôture la caisse", async ({ page }) => {
  await login(page, "comptable@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/finance/unpaid");
  const row = page.getByTestId("debtor-row").first();
  await row.getByRole("button", { name: "Relancer" }).click();
  await expect(row).toContainText("relancé le");

  await page.goto("/fr/les-etoiles/finance/cash");
  const expected = (await page.getByTestId("expected-cash").textContent())!.replace(/[^\d]/g, "");
  await page.getByLabel("Espèces comptées (FCFA)").fill(expected || "0");
  await page.getByRole("button", { name: "Clôturer la caisse" }).click();
  await expect(page.getByText(/Caisse clôturée/)).toBeVisible();
});

test("un professeur n'accède pas aux finances de l'école", async ({ page }) => {
  await login(page, "prof.maths@les-etoiles.lakol.test", PASSWORDS.staff);
  await page.goto("/fr/les-etoiles/finance/accounts");
  await expect(page.getByTestId("forbidden")).toBeVisible();
});
