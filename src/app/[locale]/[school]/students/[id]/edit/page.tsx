import { getTranslations } from "next-intl/server";
import { loadGuardedPage, loadOrDeny } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { getStudent } from "@/server/services/students";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { StudentForm } from "../../student-form";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "student.write"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("students");
  const s = await loadOrDeny(getStudent(ctx, id));
  if (!s) return <Forbidden />;
  const emergency = (s.emergencyContacts as { name?: string; phone?: string }[] | null)?.[0];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("edit")} description={`${s.firstName} ${s.lastName} · ${s.matricule}`} />
      <StudentForm
        school={school}
        defaults={{
          ...s,
          birthDate: s.birthDate?.toISOString().slice(0, 10),
          emergencyName: emergency?.name,
          emergencyPhone: emergency?.phone,
        }}
      />
    </div>
  );
}
