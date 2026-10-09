"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createStaffAction, updateStaffAction } from "./actions";

export interface StaffDefaults {
  id?: string;
  firstName?: string;
  lastName?: string;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  position?: string;
  contractType?: "PERMANENT" | "HOURLY";
  hireDate?: string;
  monthlySalary?: number | null;
  hourlyRate?: number | null;
  diplomas?: string;
}

export function StaffForm({
  school,
  defaults = {},
  roles,
}: {
  school: string;
  defaults?: StaffDefaults;
  /** Rôles proposés à la création (absent en modification : géré à part). */
  roles?: readonly string[];
}) {
  const t = useTranslations("staff");
  const te = useTranslations("enums");
  const tr = useTranslations("roles");
  const [contract, setContract] = useState(defaults.contractType ?? "PERMANENT");
  const editing = Boolean(defaults.id);

  return (
    <ActionForm
      action={editing ? updateStaffAction : createStaffAction}
      school={school}
      redirectTo={editing ? undefined : `/${school}/staff/{id}`}
      successMessage={editing ? t("saved") : undefined}
      className="gap-6"
    >
      {editing && <input type="hidden" name="id" value={defaults.id} />}
      <Card>
        <CardHeader>
          <CardTitle>{t("identity")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="lastName" label={t("lastName")}>
            <Input id="lastName" name="lastName" defaultValue={defaults.lastName} required />
          </Field>
          <Field name="firstName" label={t("firstName")}>
            <Input id="firstName" name="firstName" defaultValue={defaults.firstName} required />
          </Field>
          <Field name="gender" label={t("gender")}>
            <Select id="gender" name="gender" defaultValue={defaults.gender ?? ""}>
              <option value="">—</option>
              <option value="MALE">{te("gender.MALE")}</option>
              <option value="FEMALE">{te("gender.FEMALE")}</option>
            </Select>
          </Field>
          <Field name="position" label={t("position")}>
            <Input
              id="position"
              name="position"
              defaultValue={defaults.position}
              required
              placeholder={t("positionPlaceholder")}
            />
          </Field>
          <Field name="phone" label={t("phone")}>
            <Input id="phone" name="phone" type="tel" defaultValue={defaults.phone ?? ""} />
          </Field>
          <Field name="email" label={t("email")}>
            <Input id="email" name="email" type="email" defaultValue={defaults.email ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("contractSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="contractType" label={t("contract")}>
            <Select
              id="contractType"
              name="contractType"
              value={contract}
              onChange={(e) => setContract(e.target.value as "PERMANENT" | "HOURLY")}
            >
              <option value="PERMANENT">{te("contract.PERMANENT")}</option>
              <option value="HOURLY">{te("contract.HOURLY")}</option>
            </Select>
          </Field>
          <Field name="hireDate" label={t("hireDate")}>
            <Input id="hireDate" name="hireDate" type="date" defaultValue={defaults.hireDate} />
          </Field>
          {contract === "PERMANENT" ? (
            <Field name="monthlySalary" label={t("salary")}>
              <Input
                id="monthlySalary"
                name="monthlySalary"
                type="number"
                min={0}
                inputMode="numeric"
                defaultValue={defaults.monthlySalary ?? ""}
              />
            </Field>
          ) : (
            <Field name="hourlyRate" label={t("hourlyRate")}>
              <Input
                id="hourlyRate"
                name="hourlyRate"
                type="number"
                min={0}
                inputMode="numeric"
                defaultValue={defaults.hourlyRate ?? ""}
              />
            </Field>
          )}
          <Field name="diplomas" label={t("diplomas")} className="sm:col-span-2">
            <Textarea id="diplomas" name="diplomas" defaultValue={defaults.diplomas} />
          </Field>
        </CardContent>
      </Card>

      {roles && (
        <Card>
          <CardHeader>
            <CardTitle>{t("rolesSection")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("rolesHint")}</p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {roles.map((role) => (
              <label key={role} className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="roles[]" value={role} className="accent-primary size-5" />
                {tr(role)}
              </label>
            ))}
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <input type="checkbox" name="sendAccess" defaultChecked className="accent-primary size-5" />
              {t("sendAccess")}
            </label>
          </CardContent>
        </Card>
      )}
      <SubmitButton size="lg" className="self-start">
        {t("save")}
      </SubmitButton>
    </ActionForm>
  );
}
