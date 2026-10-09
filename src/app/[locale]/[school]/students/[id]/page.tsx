import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadSchoolPage, loadOrDeny } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { getStudent } from "@/server/services/students";
import { classOptions } from "@/server/services/options";
import { getActiveYear } from "@/server/services/structure";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "../status-badge";
import {
  changeClassAction,
  changeStatusAction,
  deleteDocumentAction,
  disableAccountAction,
  enableAccountAction,
  linkGuardianAction,
  reenrollAction,
  resendGuardianAccessAction,
  unlinkGuardianAction,
  updateGuardianLinkAction,
  uploadDocumentAction,
} from "../actions";

const RELATIONSHIPS = ["FATHER", "MOTHER", "LEGAL_GUARDIAN", "OTHER"] as const;
const DOC_CATEGORIES = ["PHOTO", "BIRTH_CERTIFICATE", "CERTIFICATE", "MEDICAL", "OTHER"] as const;

function age(birth: Date) {
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) years -= 1;
  return years;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{children || "—"}</dd>
    </div>
  );
}

export default async function StudentPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadSchoolPage(school, locale);
  if (!ctx) return <Forbidden />;
  const s = await loadOrDeny(getStudent(ctx, id));
  if (!s) return <Forbidden />;

  const [t, te, year] = await Promise.all([getTranslations("students"), getTranslations("enums"), getActiveYear(ctx)]);
  const canWrite = can(ctx.scope, "student.write");
  const canGuardians = can(ctx.scope, "guardian.write");
  const showMedical = can(ctx.scope, "student.medical.read") || ctx.activeRole === "PARENT";
  const classes = canWrite ? await classOptions(ctx) : [];
  const current = s.enrollments.find((e) => e.academicYearId === year?.id);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const emergency = (s.emergencyContacts as { name?: string; phone?: string }[] | null)?.[0];
  const base = `/${school}/students`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${s.firstName} ${s.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.matricule}
            {current && <> · {current.class.name}</>}
            <StatusBadge status={s.status} />
          </span>
        }
        actions={
          canWrite && (
            <Button variant="outline" asChild>
              <Link href={`${base}/${s.id}/edit`}>
                <Pencil /> {t("edit")}
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("identity")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              {s.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- fichier servi par /api/files avec contrôle d'accès
                <img src={s.photoUrl} alt="" className="size-20 rounded-lg object-cover" />
              ) : (
                <div className="bg-primary/10 text-primary flex size-20 items-center justify-center rounded-lg text-2xl font-bold">
                  {s.firstName.charAt(0)}
                  {s.lastName.charAt(0)}
                </div>
              )}
              <dl className="grid flex-1 grid-cols-2 gap-3 text-sm">
                <Info label={t("gender")}>{te(`gender.${s.gender}`)}</Info>
                <Info label={t("birthDate")}>
                  {s.birthDate && `${dateFmt.format(s.birthDate)} (${t("age", { age: age(s.birthDate) })})`}
                </Info>
                <Info label={t("birthPlace")}>{s.birthPlace}</Info>
                <Info label={t("nationality")}>{s.nationality}</Info>
                <Info label={t("address")}>{s.address}</Info>
              </dl>
            </div>
          </CardContent>
        </Card>

        {showMedical && (
          <Card>
            <CardHeader>
              <CardTitle>{t("medical")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Info label={t("bloodGroup")}>{s.bloodGroup}</Info>
                <Info label={t("allergies")}>{s.allergies}</Info>
                <Info label={t("medicalNotes")}>{s.medicalNotes}</Info>
                <Info label={t("emergency")}>{emergency?.phone && `${emergency.name ?? ""} ${emergency.phone}`}</Info>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("guardians")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {s.guardians.map((link) => (
            <div key={link.id} className="rounded-lg border p-4" data-testid="guardian">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">
                  {link.guardian.firstName} {link.guardian.lastName}
                </p>
                <Badge variant="outline">{te(`relationship.${link.relationship}`)}</Badge>
                {link.isPrimary && <Badge variant="secondary">{t("primary")}</Badge>}
              </div>
              <p className="text-muted-foreground text-sm">
                <a href={`tel:${link.guardian.phone}`} className="underline-offset-4 hover:underline">
                  {link.guardian.phone}
                </a>
                {link.guardian.email && ` · ${link.guardian.email}`}
                {" · "}
                {link.guardian.user?.lastLoginAt
                  ? t("lastLogin", { date: dateFmt.format(link.guardian.user.lastLoginAt) })
                  : t("neverLoggedIn")}
              </p>
              {canGuardians && (
                <details className="mt-3">
                  <summary className="text-primary cursor-pointer text-sm font-medium">{t("manage")}</summary>
                  <div className="mt-3 flex flex-col gap-4">
                    <ActionForm action={updateGuardianLinkAction} school={school} successMessage={t("saved")}>
                      <input type="hidden" name="linkId" value={link.id} />
                      <Field name="relationship" label={t("relationship")}>
                        <Select id={`rel-${link.id}`} name="relationship" defaultValue={link.relationship}>
                          {RELATIONSHIPS.map((r) => (
                            <option key={r} value={r}>
                              {te(`relationship.${r}`)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {(
                        [
                          ["isPrimary", link.isPrimary],
                          ["canViewGrades", link.canViewGrades],
                          ["canViewFinance", link.canViewFinance],
                          ["receivesNotifications", link.receivesNotifications],
                        ] as const
                      ).map(([name, checked]) => (
                        <label key={name} className="flex items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            name={name}
                            defaultChecked={checked}
                            className="accent-primary size-5"
                          />
                          {t(name)}
                        </label>
                      ))}
                      <SubmitButton size="sm" className="self-start">
                        {t("save")}
                      </SubmitButton>
                    </ActionForm>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        action={resendGuardianAccessAction}
                        school={school}
                        fields={{ guardianId: link.guardianId }}
                        confirm={t("resendConfirm")}
                      >
                        {t("resendAccess")}
                      </ActionButton>
                      <ActionButton
                        action={unlinkGuardianAction}
                        school={school}
                        fields={{ linkId: link.id }}
                        confirm={t("unlinkConfirm")}
                        variant="ghost"
                      >
                        {t("unlink")}
                      </ActionButton>
                    </div>
                  </div>
                </details>
              )}
            </div>
          ))}

          {canGuardians && (
            <details className="rounded-lg border border-dashed p-4">
              <summary className="text-primary cursor-pointer font-medium">{t("addGuardian")}</summary>
              <ActionForm
                action={linkGuardianAction}
                school={school}
                resetOnSuccess
                className="mt-4 grid gap-4 sm:grid-cols-2"
              >
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="lastName" label={t("lastName")}>
                  <Input id="g-lastName" name="lastName" required />
                </Field>
                <Field name="firstName" label={t("firstName")}>
                  <Input id="g-firstName" name="firstName" required />
                </Field>
                <Field name="phone" label={t("guardianPhone")}>
                  <Input id="g-phone" name="phone" type="tel" required />
                </Field>
                <Field name="email" label={t("guardianEmail")}>
                  <Input id="g-email" name="email" type="email" />
                </Field>
                <Field name="relationship" label={t("relationship")}>
                  <Select id="g-relationship" name="relationship" defaultValue="MOTHER">
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {te(`relationship.${r}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-3 self-end pb-3 text-sm">
                  <input type="checkbox" name="isPrimary" className="accent-primary size-5" />
                  {t("isPrimary")}
                </label>
                <SubmitButton className="self-start">{t("addGuardian")}</SubmitButton>
              </ActionForm>
            </details>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("path")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {current ? (
                <ActionForm action={changeClassAction} school={school} successMessage={t("saved")}>
                  <input type="hidden" name="studentId" value={s.id} />
                  <Field name="classId" label={t("changeClass")}>
                    <Select id="change-class" name="classId" defaultValue={current.classId}>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton size="sm" variant="outline" className="self-start">
                    {t("changeClass")}
                  </SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={reenrollAction} school={school}>
                  <input type="hidden" name="studentId" value={s.id} />
                  <Field name="classId" label={t("reenroll")}>
                    <Select id="reenroll-class" name="classId" defaultValue="">
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
                  <SubmitButton size="sm" className="self-start">
                    {t("reenroll")}
                  </SubmitButton>
                </ActionForm>
              )}
              <ActionForm
                action={changeStatusAction}
                school={school}
                confirm={t("statusConfirm")}
                successMessage={t("saved")}
              >
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="status" label={t("changeStatus")}>
                  <Select id="status" name="status" defaultValue={s.status === "PRE_REGISTERED" ? "ACTIVE" : s.status}>
                    {(["ACTIVE", "TRANSFERRED", "DROPPED", "EXPELLED"] as const).map((st) => (
                      <option key={st} value={st}>
                        {te(`studentStatus.${st}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="reason" label={t("reason")}>
                  <Textarea id="reason" name="reason" className="min-h-16" />
                </Field>
                <SubmitButton size="sm" variant="outline" className="self-start">
                  {t("applyStatus")}
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("account")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {s.accountEnabled && s.user ? (
                <>
                  <p className="text-sm">{t("accountEnabled", { username: s.user.username ?? "" })}</p>
                  <ActionButton
                    action={disableAccountAction}
                    school={school}
                    fields={{ studentId: s.id }}
                    confirm={t("disableConfirm")}
                  >
                    {t("disableAccount")}
                  </ActionButton>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">{t("accountDisabled")}</p>
                  {current?.class.level.studentAccounts === false ? (
                    <p className="text-muted-foreground text-sm">{t("levelWithoutAccounts")}</p>
                  ) : (
                    <ActionForm action={enableAccountAction} school={school} successMessage={t("accountSentToParent")}>
                      <input type="hidden" name="studentId" value={s.id} />
                      <SubmitButton size="sm" className="self-start">
                        {t("enableAccount")}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("documents")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {s.documents.length === 0 && <p className="text-muted-foreground text-sm">{t("noDocuments")}</p>}
            <ul className="flex flex-col gap-2">
              {s.documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 text-sm">
                  <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
                  <a
                    href={`/api/files/${doc.id}`}
                    target="_blank"
                    className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
                  >
                    {t(`categories.${doc.category}`)} — {doc.name}
                  </a>
                  {canWrite && (
                    <ActionButton
                      action={deleteDocumentAction}
                      school={school}
                      fields={{ documentId: doc.id }}
                      confirm={t("deleteDocumentConfirm")}
                      variant="ghost"
                      size="icon"
                    >
                      <Trash2 aria-label={t("deleteDocument")} />
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
            {canWrite && (
              <ActionForm action={uploadDocumentAction} school={school} resetOnSuccess className="border-t pt-4">
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="category" label={t("documentCategory")}>
                  <Select id="category" name="category" defaultValue="BIRTH_CERTIFICATE">
                    {DOC_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`categories.${c}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="file" label={t("file")}>
                  <Input
                    id="file"
                    name="file"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    required
                    className="pt-3"
                  />
                </Field>
                <SubmitButton size="sm" className="self-start">
                  {t("uploadDocument")}
                </SubmitButton>
              </ActionForm>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {s.enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{e.academicYear.name}</span> — {e.class.name}
                    {e.leftReason && <span className="text-muted-foreground block text-xs">{e.leftReason}</span>}
                  </span>
                  <Badge variant={e.status === "ACTIVE" ? "success" : "secondary"}>
                    {te(`enrollmentStatus.${e.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
