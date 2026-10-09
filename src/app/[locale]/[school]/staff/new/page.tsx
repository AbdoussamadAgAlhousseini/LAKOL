import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { STAFF_ROLES } from "@/server/services/staff";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { StaffForm } from "../staff-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("staff"))("new") };
}

export default async function NewStaffPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "staff.write"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("staff");
  // Seule la direction peut attribuer le rôle de direction.
  const roles = can(ctx.scope, "user.manage")
    ? STAFF_ROLES.filter((r) => r !== "DIRECTOR" || can(ctx.scope, "role.manage"))
    : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("new")} />
      <StaffForm school={school} roles={roles} />
    </div>
  );
}
