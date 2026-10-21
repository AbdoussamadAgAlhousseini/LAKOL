import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { STAFF_IMPORT_COLUMNS } from "@/server/services/staff-import";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { SpreadsheetImportForm } from "@/components/forms/spreadsheet-import-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { checkStaffImportAction, runStaffImportAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("staffImport"))("title") };
}

export default async function StaffImportPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "staff.write"));
  if (!ctx) return <Forbidden />;
  const [t, ti] = await Promise.all([getTranslations("staffImport"), getTranslations("import")]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          <Button variant="outline" asChild>
            <a href={`/api/schools/${school}/staff-import-template`}>
              <Download /> {ti("downloadTemplate")}
            </a>
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-6 pt-5">
          <p className="text-muted-foreground text-sm">
            {ti("columns")} : <code className="text-xs">{STAFF_IMPORT_COLUMNS.join(", ")}</code>
          </p>
          <p className="text-muted-foreground text-sm">{t("help")}</p>
          <SpreadsheetImportForm
            school={school}
            check={checkStaffImportAction}
            run={runStaffImportAction}
            texts="staffImport"
          />
        </CardContent>
      </Card>
    </div>
  );
}
