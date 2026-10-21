import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { IMPORT_COLUMNS } from "@/server/services/import";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SpreadsheetImportForm } from "@/components/forms/spreadsheet-import-form";
import { checkImportAction, runImportAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("import"))("title") };
}

export default async function ImportPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "student.import"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("import");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          <Button variant="outline" asChild>
            <a href={`/api/schools/${school}/import-template`}>
              <Download /> {t("downloadTemplate")}
            </a>
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-6 pt-5">
          <p className="text-muted-foreground text-sm">
            {t("columns")} : <code className="text-xs">{IMPORT_COLUMNS.join(", ")}</code>
          </p>
          <SpreadsheetImportForm school={school} check={checkImportAction} run={runImportAction} texts="import" />
        </CardContent>
      </Card>
    </div>
  );
}
