import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/server/rbac/policies";
import type { ServiceContext } from "@/server/services/context";
import { financeOverview } from "@/server/services/finance/reports";
import { createStudent } from "@/server/services/students";
import { notifyUser } from "@/server/services/notify";
import { schoolSubscription, toggleSchoolModule } from "@/server/services/subscription";
import { applyMaliTemplate, onboardingState, startSchoolYear } from "@/server/services/onboarding";
import {
  changePlan,
  issueInvoice,
  recordInvoicePayment,
  runSubscriptionLifecycle,
  setModule,
} from "@/server/platform/subscriptions";
import { availableSlug, createSchool, isValidSlug, slugify } from "@/server/platform/onboarding";
import { renderPlatformInvoice } from "@/server/pdf/platform-invoice";
import { defaultSchoolYear } from "@/lib/school-templates";
import { addDays } from "@/lib/time";
import { contextFor, uniquePhone } from "./helpers";

let director: ServiceContext;
let etoilesId: string;

beforeAll(async () => {
  director = await contextFor("les-etoiles", { email: "directeur@les-etoiles.lakol.test" }, "DIRECTOR");
  etoilesId = director.school.id;
});

afterAll(() => prisma.$disconnect());

describe("modules activables", () => {
  it("un module désactivé retire ses permissions (navigation, pages, actions)", async () => {
    const before = await contextFor("les-etoiles", { email: "comptable@les-etoiles.lakol.test" }, "ACCOUNTANT");
    await expect(financeOverview(before)).resolves.toBeTruthy();

    await toggleSchoolModule(director, "FINANCE", false);
    const after = await contextFor("les-etoiles", { email: "comptable@les-etoiles.lakol.test" }, "ACCOUNTANT");
    expect(after.scope.permissions.has("finance.read")).toBe(false);
    expect(after.scope.permissions.has("student.read")).toBe(true); // socle conservé
    await expect(financeOverview(after)).rejects.toThrow(ForbiddenError);
    expect((await schoolSubscription(director)).modules.find((m) => m.key === "FINANCE")?.active).toBe(false);

    await toggleSchoolModule(director, "FINANCE", true);
    const again = await contextFor("les-etoiles", { email: "comptable@les-etoiles.lakol.test" }, "ACCOUNTANT");
    expect(again.scope.permissions.has("finance.read")).toBe(true);
  });

  it("l'école n'active pas un module hors formule ; la plateforme peut l'offrir", async () => {
    const savoir = await prisma.school.findUniqueOrThrow({ where: { slug: "le-savoir" } });
    const savoirDirector = await prisma.user.findFirstOrThrow({
      where: { roles: { some: { schoolId: savoir.id, role: { key: "DIRECTOR" } } } },
    });
    const ctx = await contextFor("le-savoir", { id: savoirDirector.id }, "DIRECTOR");
    await expect(toggleSchoolModule(ctx, "LIBRARY", true)).rejects.toThrow("moduleNotInPlan");

    await setModule(savoir.id, "LIBRARY", true, { platform: true, actorId: null });
    const librarianPerms = await contextFor("le-savoir", { id: savoirDirector.id }, "DIRECTOR");
    expect(librarianPerms.scope.permissions.has("library.manage")).toBe(true);
    await setModule(savoir.id, "LIBRARY", false, { platform: true, actorId: null });
  });
});

describe("limites de la formule", () => {
  it("refuse une inscription au-delà du nombre d'élèves autorisé", async () => {
    const secretary = await contextFor("les-etoiles", { email: "secretariat@les-etoiles.lakol.test" }, "ADMIN");
    const count = await prisma.enrollment.count({
      where: { schoolId: etoilesId, status: "ACTIVE", academicYear: { isActive: true } },
    });
    await prisma.subscription.update({ where: { schoolId: etoilesId }, data: { maxStudents: count } });
    const cls = await secretary.db.class.findFirstOrThrow({ where: { name: "7e A" } });
    await expect(
      createStudent(secretary, {
        firstName: "Limite",
        lastName: "Test",
        gender: "MALE",
        classId: cls.id,
        guardians: [{ firstName: "P", lastName: "Test", phone: uniquePhone(), relationship: "FATHER" }],
      }),
    ).rejects.toThrow("studentLimit");
    await prisma.subscription.update({ where: { schoolId: etoilesId }, data: { maxStudents: null } });
  });

  it("quota WhatsApp atteint : email à la place, sauf message urgent", async () => {
    await prisma.subscription.update({ where: { schoolId: etoilesId }, data: { whatsappQuota: 0 } });
    const user = { id: director.user.id, phone: "+22370000010", email: "directeur@les-etoiles.lakol.test" };
    const normal = await notifyUser(director, user, { type: "test", title: "Test", body: "Quota" });
    expect(normal.channel).toBe("EMAIL");
    const urgent = await notifyUser(director, user, { type: "test", title: "Test", body: "Urgent", urgent: true });
    expect(urgent.channel).toBe("WHATSAPP");
    await prisma.subscription.update({ where: { schoolId: etoilesId }, data: { whatsappQuota: null } });
  });
});

describe("création d'école et assistant de démarrage", () => {
  it("adresses : slug lisible, réservé refusé, doublon numéroté", async () => {
    expect(slugify("Complexe Scolaire Les Étoiles")).toBe("complexe-scolaire-les-etoiles");
    expect(isValidSlug("admin")).toBe(false);
    expect(await availableSlug("les-etoiles")).toBe("les-etoiles-2");
  });

  it("crée une école en essai, puis l'assistant applique le modèle malien", async () => {
    const phone = uniquePhone();
    const { school, user } = await createSchool(
      {
        name: `École Test ${phone}`,
        city: "Ségou",
        planCode: "STANDARD",
        trial: true,
        director: { firstName: "Awa", lastName: "Keïta", phone, password: "Directrice2026!" },
      },
      { actorId: null, allowExistingAccount: false },
    );
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId: school.id } });
    expect(sub.status).toBe("TRIAL");
    expect(sub.trialEndsAt!.getTime()).toBeGreaterThan(addDays(new Date(), 29).getTime());
    expect(await prisma.role.count({ where: { schoolId: school.id, isSystem: true } })).toBeGreaterThan(5);

    // Un second compte avec le même numéro est refusé en inscription libre.
    await expect(
      createSchool(
        {
          name: "Doublon",
          planCode: "STANDARD",
          trial: true,
          director: { firstName: "X", lastName: "Y", phone, password: "Directrice2026!" },
        },
        { actorId: null, allowExistingAccount: false },
      ),
    ).rejects.toThrow("accountExists");

    const ctx = await contextFor(school.slug, { id: user.id }, "DIRECTOR");
    let state = await onboardingState(ctx);
    expect(state.completed).toBe(0);
    expect(state.finished).toBe(false);

    await startSchoolYear(ctx, defaultSchoolYear());
    const created = await applyMaliTemplate(ctx, { cycles: ["FONDAMENTAL_2", "LYCEE"] });
    // 7e, 8e, 9e + 10e (une classe) + 11e et Terminale (4 séries chacune)
    expect(created.classes).toBe(12);
    expect(created.subjects).toBeGreaterThan(5);
    expect((await applyMaliTemplate(ctx, { cycles: ["FONDAMENTAL_2"] })).classes).toBe(0); // idempotent
    const def = await ctx.db.level.findFirstOrThrow({ where: { name: "9e année" } });
    expect(def.nationalExam).toBe("DEF");

    state = await onboardingState(ctx);
    expect(state.steps.find((s) => s.key === "year")?.done).toBe(true);
    expect(state.steps.find((s) => s.key === "classes")?.done).toBe(true);
  });
});

describe("cycle de vie de l'abonnement et facturation", () => {
  it("essai -> gratuit ; actif échu -> impayé + facture -> suspendu -> payé -> actif", async () => {
    const phone = uniquePhone();
    const { school } = await createSchool(
      {
        name: `Cycle ${phone}`,
        planCode: "STANDARD",
        trial: true,
        director: { firstName: "Moussa", lastName: "Coulibaly", phone, password: "Directeur2026!" },
      },
      { actorId: null, allowExistingAccount: false },
    );
    const schoolId = school.id;
    const directorUser = await prisma.user.findFirstOrThrow({ where: { phone } });

    // Rappel 7 jours avant la fin de l'essai, une seule fois.
    await prisma.subscription.update({ where: { schoolId }, data: { trialEndsAt: addDays(new Date(), 3) } });
    await runSubscriptionLifecycle();
    await runSubscriptionLifecycle();
    expect(
      await prisma.notification.count({ where: { userId: directorUser.id, type: "subscription.trial_ending" } }),
    ).toBe(1);

    // Fin de l'essai : formule gratuite, données conservées.
    await prisma.subscription.update({ where: { schoolId }, data: { trialEndsAt: addDays(new Date(), -1) } });
    await runSubscriptionLifecycle();
    let sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId }, include: { plan: true } });
    expect(sub.status).toBe("ACTIVE");
    expect(sub.plan.code).toBe("FREE");

    // Formule payante arrivée à échéance : impayé avec délai de grâce et facture de renouvellement.
    const standard = await prisma.plan.findUniqueOrThrow({ where: { code: "STANDARD" } });
    await changePlan(schoolId, standard.id, null);
    await prisma.subscription.update({
      where: { schoolId },
      data: { currentPeriodStart: addDays(new Date(), -365), currentPeriodEnd: addDays(new Date(), -1) },
    });
    await runSubscriptionLifecycle();
    sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId }, include: { plan: true } });
    expect(sub.status).toBe("PAST_DUE");
    expect(sub.graceEndsAt).not.toBeNull();
    const invoice = await prisma.platformInvoice.findFirstOrThrow({ where: { schoolId, status: "ISSUED" } });
    expect(invoice.number).toMatch(/^LAK-\d{4}-\d{5}$/);
    expect(invoice.amount).toBe(invoice.studentCount * standard.pricePerStudent);
    await expect(issueInvoice(schoolId)).rejects.toThrow("invoiceAlreadyOpen");

    // Fin du délai de grâce : lecture seule.
    await prisma.subscription.update({ where: { schoolId }, data: { graceEndsAt: addDays(new Date(), -1) } });
    await runSubscriptionLifecycle();
    sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId }, include: { plan: true } });
    expect(sub.status).toBe("SUSPENDED");

    // Paiement enregistré : actif pour la période facturée.
    await recordInvoicePayment(invoice.id, { method: "TRANSFER", reference: "VIR-001" }, null);
    sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId }, include: { plan: true } });
    expect(sub.status).toBe("ACTIVE");
    expect(sub.currentPeriodEnd!.getTime()).toBe(invoice.periodEnd.getTime());
    expect(await prisma.auditLog.count({ where: { schoolId, action: "platform.invoice.paid" } })).toBe(1);

    const pdf = await renderPlatformInvoice({
      number: invoice.number,
      issuedAt: "1 janvier",
      dueDate: "15 janvier",
      status: "PAID",
      paidAt: "2 janvier",
      school: { name: school.name, city: null, address: null, phone: null, email: null },
      planName: "Standard",
      period: "2026-2027",
      studentCount: invoice.studentCount,
      pricePerStudent: invoice.pricePerStudent,
      amount: invoice.amount,
      currency: "XOF",
      notes: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
