"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { preRegisterAction } from "./actions";

export function PreRegistrationForm({ school, levels }: { school: string; levels: { id: string; name: string }[] }) {
  const t = useTranslations("preRegistration.public");
  const ts = useTranslations("students");
  const te = useTranslations("enums");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
        <CheckCircle2 className="text-success size-14" aria-hidden />
        <p className="text-lg font-semibold">{t("success")}</p>
      </div>
    );
  }

  const action: typeof preRegisterAction = async (slug, data) => {
    const res = await preRegisterAction(slug, data);
    if (res.ok) setSent(true);
    return res;
  };

  return (
    <ActionForm action={action} school={school} className="gap-6">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <Card>
        <CardHeader>
          <CardTitle>{t("childSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="lastName" label={ts("lastName")}>
            <Input id="lastName" name="lastName" required />
          </Field>
          <Field name="firstName" label={ts("firstName")}>
            <Input id="firstName" name="firstName" required />
          </Field>
          <Field name="gender" label={ts("gender")}>
            <Select id="gender" name="gender" defaultValue="" required>
              <option value="" disabled>
                —
              </option>
              <option value="MALE">{te("gender.MALE")}</option>
              <option value="FEMALE">{te("gender.FEMALE")}</option>
            </Select>
          </Field>
          <Field name="birthDate" label={ts("birthDate")}>
            <Input id="birthDate" name="birthDate" type="date" />
          </Field>
          <Field name="birthPlace" label={ts("birthPlace")}>
            <Input id="birthPlace" name="birthPlace" />
          </Field>
          <Field name="levelId" label={t("level")}>
            <Select id="levelId" name="levelId" defaultValue="" required>
              <option value="" disabled>
                —
              </option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="previousSchool" label={t("previousSchool")} className="sm:col-span-2">
            <Input id="previousSchool" name="previousSchool" />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("guardianSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="guardianLastName" label={ts("lastName")}>
            <Input id="guardianLastName" name="guardianLastName" required />
          </Field>
          <Field name="guardianFirstName" label={ts("firstName")}>
            <Input id="guardianFirstName" name="guardianFirstName" required />
          </Field>
          <Field name="guardianPhone" label={ts("guardianPhone")} hint={ts("guardianPhoneHint")}>
            <Input id="guardianPhone" name="guardianPhone" type="tel" inputMode="tel" required />
          </Field>
          <Field name="guardianEmail" label={ts("guardianEmail")}>
            <Input id="guardianEmail" name="guardianEmail" type="email" />
          </Field>
          <Field name="guardianRelation" label={ts("relationship")}>
            <Select id="guardianRelation" name="guardianRelation" defaultValue="FATHER">
              {(["FATHER", "MOTHER", "LEGAL_GUARDIAN", "OTHER"] as const).map((r) => (
                <option key={r} value={r}>
                  {te(`relationship.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="notes" label={t("notes")} className="sm:col-span-2">
            <Textarea id="notes" name="notes" />
          </Field>
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">{t("consent")}</p>
      <SubmitButton size="lg">{t("submit")}</SubmitButton>
    </ActionForm>
  );
}
