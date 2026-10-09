"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createStudentAction, updateStudentAction } from "./actions";

export interface StudentDefaults {
  id?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  birthDate?: string;
  birthPlace?: string | null;
  nationality?: string | null;
  address?: string | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  medicalNotes?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
}

const RELATIONSHIPS = ["FATHER", "MOTHER", "LEGAL_GUARDIAN", "OTHER"] as const;

export function StudentForm({
  school,
  classes,
  defaults = {},
}: {
  school: string;
  classes?: { id: string; name: string }[];
  defaults?: StudentDefaults;
}) {
  const t = useTranslations("students");
  const te = useTranslations("enums");
  const editing = Boolean(defaults.id);

  return (
    <ActionForm
      action={editing ? updateStudentAction : createStudentAction}
      school={school}
      redirectTo={`/${school}/students/{id}`}
      className="gap-6"
    >
      {editing && <input type="hidden" name="id" value={defaults.id} />}
      <Card>
        <CardHeader>
          <CardTitle>{t("identity")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="lastName" label={t("lastName")}>
            <Input id="lastName" name="lastName" defaultValue={defaults.lastName} required autoComplete="off" />
          </Field>
          <Field name="firstName" label={t("firstName")}>
            <Input id="firstName" name="firstName" defaultValue={defaults.firstName} required autoComplete="off" />
          </Field>
          <Field name="gender" label={t("gender")}>
            <Select id="gender" name="gender" defaultValue={defaults.gender ?? ""} required>
              <option value="" disabled>
                —
              </option>
              <option value="MALE">{te("gender.MALE")}</option>
              <option value="FEMALE">{te("gender.FEMALE")}</option>
            </Select>
          </Field>
          <Field name="birthDate" label={t("birthDate")}>
            <Input id="birthDate" name="birthDate" type="date" defaultValue={defaults.birthDate} />
          </Field>
          <Field name="birthPlace" label={t("birthPlace")}>
            <Input id="birthPlace" name="birthPlace" defaultValue={defaults.birthPlace ?? ""} />
          </Field>
          <Field name="nationality" label={t("nationality")}>
            <Input id="nationality" name="nationality" defaultValue={defaults.nationality ?? ""} />
          </Field>
          <Field name="address" label={t("address")} className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={defaults.address ?? ""} />
          </Field>
          {!editing && classes && (
            <Field name="classId" label={t("class")} className="sm:col-span-2">
              <Select id="classId" name="classId" defaultValue="" required>
                <option value="" disabled>
                  —
                </option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardContent>
      </Card>

      {!editing &&
        (["g1", "g2"] as const).map((p) => (
          <Card key={p}>
            <CardHeader>
              <CardTitle>{p === "g1" ? t("primaryGuardianTitle") : t("secondGuardianTitle")}</CardTitle>
              {p === "g2" && <p className="text-muted-foreground text-sm">{t("optional")}</p>}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field name={`${p}LastName`} label={t("lastName")}>
                <Input id={`${p}LastName`} name={`${p}LastName`} required={p === "g1"} />
              </Field>
              <Field name={`${p}FirstName`} label={t("firstName")}>
                <Input id={`${p}FirstName`} name={`${p}FirstName`} required={p === "g1"} />
              </Field>
              <Field name={`${p}Phone`} label={t("guardianPhone")} hint={t("guardianPhoneHint")}>
                <Input id={`${p}Phone`} name={`${p}Phone`} type="tel" inputMode="tel" required={p === "g1"} />
              </Field>
              <Field name={`${p}Email`} label={t("guardianEmail")}>
                <Input id={`${p}Email`} name={`${p}Email`} type="email" />
              </Field>
              <Field name={`${p}Relationship`} label={t("relationship")}>
                <Select id={`${p}Relationship`} name={`${p}Relationship`} defaultValue="">
                  <option value="">—</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {te(`relationship.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardContent>
          </Card>
        ))}

      <Card>
        <CardHeader>
          <CardTitle>{t("medical")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="bloodGroup" label={t("bloodGroup")}>
            <Select id="bloodGroup" name="bloodGroup" defaultValue={defaults.bloodGroup ?? ""}>
              <option value="">—</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field name="allergies" label={t("allergies")}>
            <Input id="allergies" name="allergies" defaultValue={defaults.allergies ?? ""} />
          </Field>
          <Field name="medicalNotes" label={t("medicalNotes")} className="sm:col-span-2">
            <Textarea id="medicalNotes" name="medicalNotes" defaultValue={defaults.medicalNotes ?? ""} />
          </Field>
          <Field name="emergencyName" label={t("emergencyName")}>
            <Input id="emergencyName" name="emergencyName" defaultValue={defaults.emergencyName ?? ""} />
          </Field>
          <Field name="emergencyPhone" label={t("emergencyPhone")}>
            <Input id="emergencyPhone" name="emergencyPhone" type="tel" defaultValue={defaults.emergencyPhone ?? ""} />
          </Field>
        </CardContent>
      </Card>

      {!editing && (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="sendAccess" defaultChecked className="accent-primary size-5" />
          {t("sendAccess")}
        </label>
      )}
      <SubmitButton size="lg" className="self-start">
        {editing ? t("save") : t("createSubmit")}
      </SubmitButton>
    </ActionForm>
  );
}
