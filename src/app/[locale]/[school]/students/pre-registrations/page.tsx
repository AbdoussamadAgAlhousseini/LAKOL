import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { can } from "@/server/rbac/policies";
import { listPreRegistrations } from "@/server/services/preregistrations";
import { classOptions } from "@/server/services/options";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { acceptPreRegistrationAction, rejectPreRegistrationAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("preRegistration"))("title") };
}

const STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;

export default async function PreRegistrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => can(c.scope, "student.write"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "PENDING";
  const [t, te, { items, total, page }, classes] = await Promise.all([
    getTranslations("preRegistration"),
    getTranslations("enums"),
    listPreRegistrations(ctx, { status, page: Number(sp.page) || 1 }),
    classOptions(ctx),
  ]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const publicUrl = `${process.env.APP_URL ?? ""}/${locale}/inscription/${school}`;
  const base = `/${school}/students/pre-registrations`;

  return (
    <>
      <PageHeader title={t("title")} description={t("publicLink", { url: publicUrl })} />
      <nav className="mb-4 flex gap-2" aria-label={t("title")}>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`${base}?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              s === status && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {t(`status.${s}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 && <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((p) => {
          const matching = classes.filter((c) => c.levelId === p.levelId);
          return (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>
                  {p.firstName} {p.lastName}
                </CardTitle>
                <p className="text-muted-foreground text-sm">
                  {p.level.name} · {te(`gender.${p.gender}`)}
                  {p.birthDate && ` · ${dateFmt.format(p.birthDate)}`} ·{" "}
                  {t("submittedAt", { date: dateFmt.format(p.createdAt) })}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <p>
                  {te(`relationship.${p.guardianRelation}`)} : {p.guardianFirstName} {p.guardianLastName} ·{" "}
                  <a href={`tel:${p.guardianPhone}`} className="underline">
                    {p.guardianPhone}
                  </a>
                  {p.previousSchool && (
                    <span className="text-muted-foreground block">
                      {t("previousSchool")} : {p.previousSchool}
                    </span>
                  )}
                  {p.notes && <span className="text-muted-foreground block">{p.notes}</span>}
                  {p.rejectionReason && <span className="text-destructive block">{p.rejectionReason}</span>}
                </p>
                {p.status === "ACCEPTED" && p.studentId && (
                  <Link href={`/${school}/students/${p.studentId}`} className="text-primary underline">
                    {t("openStudent")}
                  </Link>
                )}
                {p.status === "PENDING" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ActionForm
                      action={acceptPreRegistrationAction}
                      school={school}
                      redirectTo={`/${school}/students/{id}`}
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <Field name="classId" label={t("chooseClass")}>
                        <Select id={`class-${p.id}`} name="classId" defaultValue={matching[0]?.id ?? ""}>
                          {matching.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <SubmitButton size="sm" disabled={matching.length === 0}>
                        {t("accept")}
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={rejectPreRegistrationAction} school={school}>
                      <input type="hidden" name="id" value={p.id} />
                      <Field name="reason" label={t("rejectReason")}>
                        <Input id={`reason-${p.id}`} name="reason" />
                      </Field>
                      <SubmitButton size="sm" variant="outline">
                        {t("reject")}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Pagination basePath={base} page={page} total={total} params={{ status }} />
    </>
  );
}
