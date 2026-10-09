import sharp from "sharp";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "@/server/services/context";
import type { SchoolContext } from "@/server/context";
import { createResource, listResources } from "@/server/services/resources";
import { familyCanteen, saveMenu, subscribeCanteen, weekMenus } from "@/server/services/modules/canteen";
import { assignStudent, familyTransport, saveRoute } from "@/server/services/modules/transport";
import { lendBook, returnBook, saveBook } from "@/server/services/modules/library";
import { recordVisit } from "@/server/services/modules/infirmary";
import { lowStockCount, moveStock, saveItem } from "@/server/services/modules/inventory";
import { exportXlsx } from "@/server/services/exports";
import { getSchoolInsights, getStudentProgress } from "@/server/services/dashboard";
import { compressUpload } from "@/server/images";
import { dayStart } from "@/lib/time";
import { contextFor } from "./helpers";

let director: ServiceContext;
let teacher: ServiceContext;
let parent: ServiceContext;
let student: ServiceContext;
let aminata: string;

beforeAll(async () => {
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
  teacher = await contextFor("les-etoiles", { email: "prof.maths@les-etoiles.lakol.test" }, "HEAD_TEACHER");
  parent = await contextFor("les-etoiles", { phone: "+22370000001" }, "PARENT");
  student = await contextFor("les-etoiles", { username: "eto-25-0029" }, "STUDENT");
  aminata = (await director.db.student.findFirstOrThrow({ where: { matricule: "ETO-25-0029" } })).id;
});

afterAll(() => prisma.$disconnect());

/** Les indicateurs du tableau de bord attendent un contexte de page (avec le rôle actif). */
const asPage = (ctx: ServiceContext, activeRole: string) => ({ ...ctx, activeRole }) as unknown as SchoolContext;

describe("ressources pédagogiques", () => {
  it("le professeur publie dans sa matière ; l'élève voit les ressources de son niveau", async () => {
    const math = await director.db.subject.findFirstOrThrow({ where: { code: "MATH" } });
    const ang = await director.db.subject.findFirstOrThrow({ where: { code: "ANG" } });
    const lv7 = await director.db.level.findFirstOrThrow({ where: { name: "7e année" } });
    await createResource(teacher, {
      subjectId: math.id,
      levelId: lv7.id,
      type: "EXERCISE",
      title: "Exercices sur les fractions",
      url: "https://exemple.ml/fractions",
    });
    await expect(
      createResource(teacher, { subjectId: ang.id, type: "COURSE", title: "x", url: "https://exemple.ml" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(createResource(teacher, { subjectId: math.id, type: "COURSE", title: "x" })).rejects.toThrow(
      "fileOrLinkRequired",
    );

    const seen = await listResources(student, {});
    expect(seen.items.some((r) => r.title === "Exercices sur les fractions")).toBe(true);
    // Le sujet du DEF (9e) n'est pas proposé à une élève de 7e.
    expect(seen.items.some((r) => r.title.startsWith("Sujet DEF"))).toBe(false);
  });
});

describe("modules optionnels", () => {
  it("cantine : inscription, menus, vue famille", async () => {
    const monday = dayStart();
    await saveMenu(director, { date: monday, meal: "Riz au poisson" });
    expect((await weekMenus(parent, monday))[0].menu?.meal).toBe("Riz au poisson");
    const other = await director.db.enrollment.findFirstOrThrow({ where: { class: { name: "5e A" } } });
    await subscribeCanteen(director, { studentId: other.studentId, dietNotes: "Sans porc" });
    await expect(subscribeCanteen(parent, { studentId: aminata })).rejects.toThrow(ForbiddenError);
    const family = await familyCanteen(parent);
    expect(family.find((c) => c.id === aminata)?.diet).toBe("Allergie à l'arachide");
  });

  it("transport : capacité du véhicule respectée, la famille voit le bus et l'arrêt", async () => {
    const small = await saveRoute(director, { name: "Petit circuit", capacity: 1 });
    const pupils = await director.db.enrollment.findMany({ where: { class: { name: "5e A" } }, take: 2 });
    await assignStudent(director, { studentId: pupils[0].studentId, routeId: small.id });
    await expect(assignStudent(director, { studentId: pupils[1].studentId, routeId: small.id })).rejects.toThrow(
      "busFull",
    );
    const family = await familyTransport(parent);
    const bus = family.find((c) => c.id === aminata)?.assignment;
    expect(bus?.route.name).toBe("Circuit Kalaban");
    expect(bus?.stop?.pickupMin).toBeGreaterThan(0);
  });

  it("bibliothèque : plus de prêt sans exemplaire disponible, retour", async () => {
    const book = await saveBook(director, { title: "Exemplaire unique", copies: 1 });
    const loan = await lendBook(director, { bookId: book.id, studentId: aminata });
    await expect(lendBook(director, { bookId: book.id, studentId: aminata })).rejects.toThrow("noCopyAvailable");
    await expect(saveBook(director, { id: book.id, title: book.title, copies: 0 })).rejects.toThrow();
    await returnBook(director, loan.id);
    await expect(returnBook(director, loan.id)).rejects.toThrow("alreadyReturned");
  });

  it("infirmerie : les parents sont prévenus si l'élève rentre chez lui ; un professeur n'y a pas accès", async () => {
    await recordVisit(director, { studentId: aminata, reason: "Fièvre", outcome: "SENT_HOME" });
    expect(
      await prisma.notification.count({ where: { type: "infirmary.visit", user: { phone: "+22370000001" } } }),
    ).toBeGreaterThan(0);
    await expect(recordVisit(teacher, { studentId: aminata, reason: "x", outcome: "RESTED" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("stocks : pas de sortie au-delà du stock, alerte sous le seuil", async () => {
    const item = await saveItem(director, { name: "Cahiers", unit: "unité", minQuantity: 5 });
    await moveStock(director, { itemId: item.id, delta: 10, reason: "Achat" });
    await expect(moveStock(director, { itemId: item.id, delta: -11, reason: "Distribution" })).rejects.toThrow(
      "insufficientStock",
    );
    const before = await lowStockCount(director);
    await moveStock(director, { itemId: item.id, delta: -6, reason: "Distribution" });
    expect(await lowStockCount(director)).toBe(before + 1);
  });
});

describe("exports Excel", () => {
  it("produit des classeurs lisibles ; un parent n'exporte pas la liste des élèves", async () => {
    const term = await director.db.term.findFirstOrThrow({ where: { academicYear: { isActive: true }, order: 1 } });
    const class7 = await director.db.class.findFirstOrThrow({ where: { name: "7e A" } });
    for (const [kind, params] of [
      ["students", {}],
      ["debtors", {}],
      ["payments", { from: new Date("2025-01-01"), to: new Date("2027-01-01") }],
      ["attendance", {}],
      ["class-results", { classId: class7.id, termId: term.id }],
    ] as const) {
      const { buffer } = await exportXlsx(director, kind, params);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(new Uint8Array(buffer).buffer);
      expect(wb.worksheets[0].rowCount).toBeGreaterThan(1);
    }
    await expect(exportXlsx(parent, "students", {})).rejects.toThrow(ForbiddenError);
  });
});

describe("tableaux de bord avancés", () => {
  it("direction : tendance d'assiduité, résultats par classe et alertes", async () => {
    const insights = await getSchoolInsights(asPage(director, "DIRECTOR"));
    expect(insights!.attendance).toHaveLength(8);
    expect(insights!.results!.length).toBeGreaterThan(0);
    const keys = insights!.alerts.map((a) => a.key);
    expect(keys).toContain("lowStock");
    expect(keys).toContain("lateLoans");
  });

  it("parent : progression de l'enfant par période", async () => {
    const progress = await getStudentProgress(asPage(parent, "PARENT"), aminata);
    expect(progress.points.length).toBeGreaterThan(0);
    expect(progress.points.some((p) => p.average !== null)).toBe(true);
  });
});

describe("performances", () => {
  it("compresse une grande photo en WebP", async () => {
    const photo = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 40 } },
    })
      .png()
      .toBuffer();
    const { body, mimeType } = await compressUpload(photo, "image/png");
    expect(mimeType).toBe("image/webp");
    expect(body.length).toBeLessThan(photo.length);
    const meta = await sharp(body).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1600);
  });
});
