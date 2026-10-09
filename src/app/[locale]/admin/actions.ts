"use server";

import { z } from "zod";
import { platformAction } from "@/server/platform-action";
import { updatePlan } from "@/server/platform/admin";
import { createSchool } from "@/server/platform/onboarding";
import {
  changePlan,
  extendTrial,
  issueInvoice,
  recordInvoicePayment,
  setModule,
  setSuspended,
  updateSubscriptionTerms,
  voidInvoice,
} from "@/server/platform/subscriptions";
import { optionalPhone } from "@/server/phone-field";
import { MODULE_KEYS } from "@/lib/modules";
import { checkbox, email, id, int, optionalInt, optionalText, text } from "@/lib/zod";

const moduleKey = z.enum(MODULE_KEYS);

export const createSchoolAction = platformAction(
  z.object({
    name: text(160),
    slug: optionalText(40),
    city: optionalText(80),
    phone: optionalText(30),
    email: email.optional(),
    planCode: z.enum(["FREE", "STANDARD", "PREMIUM"]),
    trial: checkbox,
    directorFirstName: text(80),
    directorLastName: text(80),
    directorPhone: optionalText(30),
    directorEmail: email.optional(),
  }),
  async (admin, input) => {
    const { school } = await createSchool(
      {
        name: input.name,
        slug: input.slug?.toLowerCase() ?? null,
        city: input.city ?? null,
        phone: optionalPhone(input.phone, "ML", "phone"),
        email: input.email ?? null,
        planCode: input.planCode,
        trial: input.trial,
        director: {
          firstName: input.directorFirstName,
          lastName: input.directorLastName,
          phone: optionalPhone(input.directorPhone, "ML", "directorPhone"),
          email: input.directorEmail ?? null,
        },
      },
      { actorId: admin.id, allowExistingAccount: true },
    );
    return { id: school.id };
  },
);

export const changePlanAction = platformAction(z.object({ schoolId: id, planId: id }), async (admin, i) =>
  changePlan(i.schoolId, i.planId, admin.id),
);

export const updateTermsAction = platformAction(
  z.object({
    schoolId: id,
    maxStudents: optionalInt(1, 100_000),
    pricePerStudent: optionalInt(0, 1_000_000),
    whatsappQuota: optionalInt(0, 10_000_000),
  }),
  async (admin, i) =>
    updateSubscriptionTerms(
      i.schoolId,
      {
        maxStudents: i.maxStudents ?? null,
        pricePerStudent: i.pricePerStudent ?? null,
        whatsappQuota: i.whatsappQuota ?? null,
      },
      admin.id,
    ),
);

export const extendTrialAction = platformAction(z.object({ schoolId: id, days: int(1, 365) }), async (admin, i) =>
  extendTrial(i.schoolId, i.days, admin.id),
);

export const suspendAction = platformAction(z.object({ schoolId: id, suspended: checkbox }), async (admin, i) =>
  setSuspended(i.schoolId, i.suspended, admin.id),
);

export const moduleAction = platformAction(
  z.object({ schoolId: id, module: moduleKey, enabled: checkbox }),
  async (admin, i) => setModule(i.schoolId, i.module, i.enabled, { platform: true, actorId: admin.id }),
);

export const issueInvoiceAction = platformAction(
  z.object({ schoolId: id, studentCount: optionalInt(1, 100_000), notes: optionalText(500) }),
  async (admin, i) => {
    await issueInvoice(i.schoolId, { studentCount: i.studentCount, notes: i.notes ?? null }, admin.id);
  },
);

export const payInvoiceAction = platformAction(
  z.object({
    invoiceId: id,
    method: z.enum(["CASH", "CHEQUE", "TRANSFER", "MOBILE_MONEY"]),
    reference: optionalText(80),
  }),
  async (admin, i) => recordInvoicePayment(i.invoiceId, { method: i.method, reference: i.reference ?? null }, admin.id),
);

export const voidInvoiceAction = platformAction(z.object({ invoiceId: id, reason: text(300) }), async (admin, i) =>
  voidInvoice(i.invoiceId, i.reason, admin.id),
);

export const updatePlanAction = platformAction(
  z.object({
    id,
    name: text(60),
    maxStudents: optionalInt(1, 100_000),
    whatsappQuota: int(0, 10_000_000),
    pricePerStudent: int(0, 1_000_000),
    modules: z.array(moduleKey).default([]),
    isActive: checkbox,
  }),
  async (_admin, i) => {
    await updatePlan(i.id, { ...i, maxStudents: i.maxStudents ?? null });
  },
);
