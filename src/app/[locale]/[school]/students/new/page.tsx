import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { classOptions } from "@/server/services/options";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { StudentForm } from "../student-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("students"))("new") };
}

export default async function NewStudentPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "student.write"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("students");
  const classes = await classOptions(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("new")} description={t("newIntro")} />
      {classes.length === 0 ? <Alert>{t("noClass")}</Alert> : <StudentForm school={school} classes={classes} />}
    </div>
  );
}
