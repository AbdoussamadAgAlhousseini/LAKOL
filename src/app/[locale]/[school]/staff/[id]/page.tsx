import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage, loadOrDeny } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { getStaff, STAFF_ROLES } from "@/server/services/staff";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffForm } from "../staff-form";
import { deactivateStaffAction, reactivateStaffAction, resendStaffAccessAction, setStaffRolesAction } from "../actions";

export default async function StaffMemberPage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "staff.read"));
  if (!ctx) return <Forbidden />;
  const s = await loadOrDeny(getStaff(ctx, id));
  if (!s) return <Forbidden />;
  const [t, tr, te] = await Promise.all([getTranslations("staff"), getTranslations("roles"), getTranslations("enums")]);
  const canWrite = can(ctx.scope, "staff.write");
  const canRoles = can(ctx.scope, "user.manage");
  const assignable = STAFF_ROLES.filter((r) => r !== "DIRECTOR" || can(ctx.scope, "role.manage"));
  const current = new Set(s.user?.roles.map((r) => r.role.key) ?? []);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const diplomas = ((s.diplomas as { title: string }[] | null) ?? []).map((d) => d.title).join("\n");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${s.firstName} ${s.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.position} · {te(`contract.${s.contractType}`)}
            {!s.isActive && <Badge variant="secondary">{t("inactiveBadge")}</Badge>}
          </span>
        }
        actions={
          canWrite &&
          (s.isActive ? (
            <ActionButton
              action={deactivateStaffAction}
              school={school}
              fields={{ staffId: s.id }}
              confirm={t("deactivateConfirm")}
            >
              {t("deactivate")}
            </ActionButton>
          ) : (
            <ActionButton action={reactivateStaffAction} school={school} fields={{ staffId: s.id }}>
              {t("reactivate")}
            </ActionButton>
          ))
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("account")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {s.user ? (
              <p>
                {s.user.phone ?? s.user.email} ·{" "}
                {s.user.lastLoginAt ? t("lastLogin", { date: dateFmt.format(s.user.lastLoginAt) }) : t("neverLoggedIn")}
              </p>
            ) : (
              <p className="text-muted-foreground">{t("noAccount")}</p>
            )}
            {canRoles && s.isActive ? (
              <ActionForm action={setStaffRolesAction} school={school} successMessage={t("saved")}>
                <input type="hidden" name="staffId" value={s.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  {assignable.map((role) => (
                    <label key={role} className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        name="roles[]"
                        value={role}
                        defaultChecked={current.has(role)}
                        className="accent-primary size-5"
                      />
                      {tr(role)}
                    </label>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">{t("rolesHint")}</p>
                <SubmitButton size="sm" className="self-start">
                  {t("saveRoles")}
                </SubmitButton>
              </ActionForm>
            ) : (
              <div className="flex flex-wrap gap-1">
                {[...current].map((k) => (
                  <Badge key={k} variant="outline">
                    {tr.has(k) ? tr(k) : k}
                  </Badge>
                ))}
              </div>
            )}
            {canRoles && s.user && (
              <ActionButton
                action={resendStaffAccessAction}
                school={school}
                fields={{ staffId: s.id }}
                confirm={t("resendConfirm")}
              >
                {t("resendAccess")}
              </ActionButton>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("assignments")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {s.headOfClasses
              .filter((c) => c.academicYear.isActive)
              .map((c) => (
                <p key={c.id}>
                  {t("headOf")}{" "}
                  <Link
                    href={`/${school}/classes/${c.id}`}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                </p>
              ))}
            {s.teachingAssignments.length === 0 && <p className="text-muted-foreground">{t("noAssignment")}</p>}
            <ul className="flex flex-col gap-1">
              {s.teachingAssignments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/${school}/classes/${a.classId}`}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {a.class.name}
                  </Link>{" "}
                  — {a.subject.name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {canWrite && (
        <StaffForm
          school={school}
          defaults={{
            ...s,
            hireDate: s.hireDate?.toISOString().slice(0, 10),
            diplomas,
          }}
        />
      )}
    </div>
  );
}
