import "server-only";
import type { TermKind } from "@prisma/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { actor, paginate, type ServiceContext } from "./context";
import { storeDocument } from "./students";

export interface SchoolSettingsInput {
  name: string;
  shortName?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  defaultLocale: "fr" | "en";
  currency: string;
  gradingScale: 10 | 20;
  termKind: TermKind;
  primaryColor: string;
  secondaryColor: string;
  reportCardHeader?: string | null;
  blockReportIfUnpaid: boolean;
}

export async function updateSchoolSettings(ctx: ServiceContext, input: SchoolSettingsInput) {
  const before = ctx.school;
  const updated = await ctx.db.school.update({
    where: { id: ctx.school.id },
    data: {
      ...input,
      shortName: input.shortName ?? null,
      city: input.city ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      reportCardHeader: input.reportCardHeader ?? null,
    },
  });
  const changed = Object.fromEntries(
    Object.entries(input).filter(([k, v]) => (before as Record<string, unknown>)[k] !== (v ?? null)),
  );
  if (Object.keys(changed).length > 0) {
    await audit(ctx.db, actor(ctx), {
      action: "school.settings",
      entityType: "School",
      entityId: ctx.school.id,
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])),
      after: changed,
    });
  }
  return updated;
}

export async function uploadLogo(ctx: ServiceContext, file: File) {
  if (!file.type.startsWith("image/")) throw new DomainError("fileType", "file");
  const doc = await storeDocument(ctx, { entityType: "School", entityId: ctx.school.id, category: "LOGO", file });
  await ctx.db.school.update({ where: { id: ctx.school.id }, data: { logoUrl: `/api/files/${doc.id}` } });
}

export async function listAuditLogs(ctx: ServiceContext, filters: { entityType?: string; page?: number }) {
  const { skip, take, page } = paginate(filters.page);
  const where = filters.entityType ? { entityType: filters.entityType } : {};
  const [items, total] = await Promise.all([
    ctx.db.auditLog.findMany({
      where,
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    ctx.db.auditLog.count({ where }),
  ]);
  return { items, total, page };
}
