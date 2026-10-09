import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateSettingsAction, uploadLogoAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("title") };
}

export default async function SettingsPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "school.settings.manage"));
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("settings");
  const s = ctx.school;
  const publicUrl = `${process.env.APP_URL ?? ""}/${locale}/inscription/${s.slug}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} />
      <ActionForm action={updateSettingsAction} school={school} successMessage={t("saved")} className="gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("identity")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label={t("name")} className="sm:col-span-2">
              <Input id="name" name="name" defaultValue={s.name} required />
            </Field>
            <Field name="shortName" label={t("shortName")}>
              <Input id="shortName" name="shortName" defaultValue={s.shortName ?? ""} />
            </Field>
            <Field name="city" label={t("city")}>
              <Input id="city" name="city" defaultValue={s.city ?? ""} />
            </Field>
            <Field name="address" label={t("address")} className="sm:col-span-2">
              <Input id="address" name="address" defaultValue={s.address ?? ""} />
            </Field>
            <Field name="phone" label={t("phone")}>
              <Input id="phone" name="phone" type="tel" defaultValue={s.phone ?? ""} />
            </Field>
            <Field name="email" label={t("email")}>
              <Input id="email" name="email" type="email" defaultValue={s.email ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("academic")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="gradingScale" label={t("gradingScale")}>
              <Select id="gradingScale" name="gradingScale" defaultValue={String(s.gradingScale)}>
                <option value="20">{t("scale20")}</option>
                <option value="10">{t("scale10")}</option>
              </Select>
            </Field>
            <Field name="termKind" label={t("termKind")} hint={t("termKindHint")}>
              <Select id="termKind" name="termKind" defaultValue={s.termKind}>
                <option value="TRIMESTER">{t("TRIMESTER")}</option>
                <option value="SEMESTER">{t("SEMESTER")}</option>
              </Select>
            </Field>
            <Field name="currency" label={t("currency")}>
              <Select id="currency" name="currency" defaultValue={s.currency}>
                {["XOF", "XAF", "GNF", "EUR", "USD"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field name="defaultLocale" label={t("defaultLocale")}>
              <Select id="defaultLocale" name="defaultLocale" defaultValue={s.defaultLocale}>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="blockReportIfUnpaid"
                defaultChecked={s.blockReportIfUnpaid}
                className="accent-primary size-5"
              />
              {t("blockReportIfUnpaid")}
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("branding")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="primaryColor" label={t("primaryColor")}>
              <Input id="primaryColor" name="primaryColor" type="color" defaultValue={s.primaryColor} className="p-1" />
            </Field>
            <Field name="secondaryColor" label={t("secondaryColor")}>
              <Input
                id="secondaryColor"
                name="secondaryColor"
                type="color"
                defaultValue={s.secondaryColor}
                className="p-1"
              />
            </Field>
            <Field name="reportCardHeader" label={t("reportCardHeader")} className="sm:col-span-2">
              <Textarea id="reportCardHeader" name="reportCardHeader" defaultValue={s.reportCardHeader ?? ""} />
            </Field>
          </CardContent>
        </Card>
        <SubmitButton size="lg" className="self-start">
          {t("save")}
        </SubmitButton>
      </ActionForm>

      <Card>
        <CardHeader>
          <CardTitle>{t("logo")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {s.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- fichier servi par /api/files avec contrôle d'accès
            <img src={s.logoUrl} alt="" className="h-20 w-auto self-start rounded" />
          )}
          <ActionForm action={uploadLogoAction} school={school} resetOnSuccess>
            <Field name="file" label={t("logoFile")}>
              <Input
                id="logo"
                name="file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required
                className="pt-3"
              />
            </Field>
            <SubmitButton size="sm" className="self-start">
              {t("uploadLogo")}
            </SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("publicForm")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm break-all">
            <a href={`/${locale}/inscription/${s.slug}`} className="text-primary underline" target="_blank">
              {publicUrl}
            </a>
          </p>
          <p className="text-muted-foreground mt-2 text-sm">{t("publicFormHint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
