import { getTranslations } from "next-intl/server";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createSchoolAction } from "../../actions";

export default async function NewSchoolPage() {
  const t = await getTranslations("admin");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("newSchool")} description={t("newSchoolHint")} />
      <ActionForm action={createSchoolAction} school="" redirectTo="/admin/schools/{id}" className="gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("schoolInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label={t("schoolName")} className="sm:col-span-2">
              <Input id="name" name="name" required maxLength={160} />
            </Field>
            <Field name="slug" label={t("slug")} hint={t("slugHint")}>
              <Input id="slug" name="slug" maxLength={40} pattern="[a-z0-9-]+" />
            </Field>
            <Field name="city" label={t("city")}>
              <Input id="city" name="city" maxLength={80} />
            </Field>
            <Field name="phone" label={t("phone")}>
              <Input id="phone" name="phone" type="tel" />
            </Field>
            <Field name="email" label={t("email")}>
              <Input id="email" name="email" type="email" />
            </Field>
            <Field name="planCode" label={t("plan")}>
              <Select id="planCode" name="planCode" defaultValue="STANDARD">
                <option value="FREE">Essai / Gratuit</option>
                <option value="STANDARD">Standard</option>
                <option value="PREMIUM">Premium</option>
              </Select>
            </Field>
            <label className="flex items-center gap-3 self-end text-sm">
              <input type="checkbox" name="trial" defaultChecked className="accent-primary size-5" />
              {t("startTrial")}
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("director")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("directorHint")}</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="directorFirstName" label={t("firstName")}>
              <Input id="directorFirstName" name="directorFirstName" required />
            </Field>
            <Field name="directorLastName" label={t("lastName")}>
              <Input id="directorLastName" name="directorLastName" required />
            </Field>
            <Field name="directorPhone" label={t("phone")}>
              <Input id="directorPhone" name="directorPhone" type="tel" />
            </Field>
            <Field name="directorEmail" label={t("email")}>
              <Input id="directorEmail" name="directorEmail" type="email" />
            </Field>
          </CardContent>
        </Card>
        <SubmitButton className="self-start">{t("createSchool")}</SubmitButton>
      </ActionForm>
    </div>
  );
}
