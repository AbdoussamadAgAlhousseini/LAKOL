import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExternalLink, FileText } from "lucide-react";
import { DomainError } from "@/server/errors";
import { platformSchool } from "@/server/platform/admin";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { INVOICE_VARIANT, STATUS_VARIANT } from "@/components/admin/status";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  changePlanAction,
  extendTrialAction,
  issueInvoiceAction,
  moduleAction,
  payInvoiceAction,
  suspendAction,
  updateTermsAction,
  voidInvoiceAction,
} from "../../actions";

export default async function AdminSchoolPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const data = await platformSchool(id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const t = await getTranslations("admin");
  const tm = await getTranslations("modules");
  const { school, subscription: sub, limits } = data;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
  const money = (v: number) => formatMoney(v, "XOF", locale);
  const openInvoice = data.invoices.find((i) => i.status === "ISSUED");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={school.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {school.slug}
            {school.city && ` · ${school.city}`}
            {sub && <Badge variant={STATUS_VARIANT[sub.status]}>{t(`statuses.${sub.status}`)}</Badge>}
          </span>
        }
        actions={
          <a
            href={`/${locale}/${school.slug}/dashboard`}
            className="text-primary inline-flex items-center gap-1 text-sm underline"
          >
            <ExternalLink className="size-4" aria-hidden /> {t("openSchool")}
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="subscription-card">
          <CardHeader>
            <CardTitle>{t("subscription")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {sub && (
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">{t("plan")}</dt>
                <dd className="font-medium">{sub.plan.name}</dd>
                {sub.trialEndsAt && (
                  <>
                    <dt className="text-muted-foreground">{t("trialEnds")}</dt>
                    <dd>{date.format(sub.trialEndsAt)}</dd>
                  </>
                )}
                {sub.currentPeriodEnd && (
                  <>
                    <dt className="text-muted-foreground">{t("periodEnds")}</dt>
                    <dd>{date.format(sub.currentPeriodEnd)}</dd>
                  </>
                )}
                {sub.graceEndsAt && (
                  <>
                    <dt className="text-muted-foreground">{t("graceEnds")}</dt>
                    <dd>{date.format(sub.graceEndsAt)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t("students")}</dt>
                <dd className="tabular-nums">
                  {data.students} / {limits?.maxStudents ?? "∞"}
                </dd>
                <dt className="text-muted-foreground">{t("whatsappMonth")}</dt>
                <dd className="tabular-nums">
                  {data.whatsapp} / {limits?.whatsappQuota ?? "∞"}
                </dd>
                <dt className="text-muted-foreground">{t("pricePerStudent")}</dt>
                <dd>{money(limits?.pricePerStudent ?? 0)}</dd>
              </dl>
            )}
            <ActionForm
              action={changePlanAction}
              school=""
              successMessage={t("saved")}
              className="flex-row items-end gap-2"
            >
              <input type="hidden" name="schoolId" value={school.id} />
              <Field name="planId" label={t("changePlan")} className="flex-1">
                <Select id="planId" name="planId" defaultValue={sub?.planId}>
                  {data.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton variant="outline">{t("apply")}</SubmitButton>
            </ActionForm>
            {sub?.status === "TRIAL" && (
              <div className="flex flex-wrap gap-2">
                <ActionForm
                  action={extendTrialAction}
                  school=""
                  successMessage={t("saved")}
                  className="flex-row items-end gap-2"
                >
                  <input type="hidden" name="schoolId" value={school.id} />
                  <Field name="days" label={t("extendTrial")}>
                    <Input id="days" name="days" type="number" min={1} max={365} defaultValue={15} className="w-24" />
                  </Field>
                  <SubmitButton variant="outline">{t("extend")}</SubmitButton>
                </ActionForm>
              </div>
            )}
            <div>
              {sub?.status === "SUSPENDED" ? (
                <ActionButton action={suspendAction} school="" fields={{ schoolId: school.id }} variant="default">
                  {t("reactivate")}
                </ActionButton>
              ) : (
                <ActionButton
                  action={suspendAction}
                  school=""
                  fields={{ schoolId: school.id, suspended: "on" }}
                  variant="destructive"
                  confirm={t("confirmSuspend")}
                >
                  {t("suspend")}
                </ActionButton>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("terms")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("termsHint")}</p>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={updateTermsAction}
              school=""
              successMessage={t("saved")}
              className="grid gap-3 sm:grid-cols-3"
            >
              <input type="hidden" name="schoolId" value={school.id} />
              <Field name="maxStudents" label={t("maxStudents")}>
                <Input
                  id="maxStudents"
                  name="maxStudents"
                  type="number"
                  min={1}
                  defaultValue={sub?.maxStudents ?? undefined}
                  placeholder={String(sub?.plan.maxStudents ?? "∞")}
                />
              </Field>
              <Field name="pricePerStudent" label={t("pricePerStudent")}>
                <Input
                  id="pricePerStudent"
                  name="pricePerStudent"
                  type="number"
                  min={0}
                  defaultValue={sub?.pricePerStudent ?? undefined}
                  placeholder={String(sub?.plan.pricePerStudent ?? 0)}
                />
              </Field>
              <Field name="whatsappQuota" label={t("whatsappQuota")}>
                <Input
                  id="whatsappQuota"
                  name="whatsappQuota"
                  type="number"
                  min={0}
                  defaultValue={sub?.whatsappQuota ?? undefined}
                  placeholder={String(sub?.plan.whatsappQuota ?? 0)}
                />
              </Field>
              <SubmitButton variant="outline" className="self-start">
                {t("save")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("modules")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("modulesHint")}</p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-modules">
          {data.modules.map((m) => (
            <div key={m.key} className="flex items-center gap-3 rounded-md border p-3 text-sm">
              <span
                className={cn("size-2.5 rounded-full", m.active ? "bg-success" : "bg-muted-foreground/30")}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{tm(m.key)}</p>
                <p className="text-muted-foreground text-xs">
                  {m.inPlan
                    ? m.disabledBySchool
                      ? t("disabledBySchool")
                      : t("inPlan")
                    : m.granted
                      ? t("granted")
                      : t("notInPlan")}
                </p>
              </div>
              {!m.inPlan && (
                <ActionButton
                  action={moduleAction}
                  school=""
                  fields={{ schoolId: school.id, module: m.key, ...(m.granted ? {} : { enabled: "on" }) }}
                >
                  {m.granted ? t("revoke") : t("grant")}
                </ActionButton>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invoices")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!openInvoice && (limits?.pricePerStudent ?? 0) > 0 && (
            <ActionForm
              action={issueInvoiceAction}
              school=""
              successMessage={t("invoiceIssued")}
              className="grid gap-3 sm:grid-cols-3"
            >
              <input type="hidden" name="schoolId" value={school.id} />
              <Field name="studentCount" label={t("billedStudents")} hint={t("billedStudentsHint")}>
                <Input
                  id="studentCount"
                  name="studentCount"
                  type="number"
                  min={1}
                  placeholder={String(data.students)}
                />
              </Field>
              <Field name="notes" label={t("notes")} className="sm:col-span-2">
                <Input id="notes" name="notes" maxLength={500} />
              </Field>
              <SubmitButton className="self-start">{t("issueInvoice")}</SubmitButton>
            </ActionForm>
          )}
          <div className="divide-y rounded-md border" data-testid="admin-invoices">
            {data.invoices.length === 0 && <p className="text-muted-foreground p-4 text-sm">{t("noInvoice")}</p>}
            {data.invoices.map((inv) => (
              <div key={inv.id} className="flex flex-col gap-3 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a
                    href={`/api/platform-invoices/${inv.id}`}
                    target="_blank"
                    className="text-primary inline-flex items-center gap-1 font-medium underline"
                  >
                    <FileText className="size-4" aria-hidden /> {inv.number}
                  </a>
                  <Badge variant={INVOICE_VARIANT[inv.status]}>{t(`invoiceStatuses.${inv.status}`)}</Badge>
                  <span className="font-semibold tabular-nums">{money(inv.amount)}</span>
                  <span className="text-muted-foreground text-xs">
                    {t("period", { from: date.format(inv.periodStart), to: date.format(inv.periodEnd) })} ·{" "}
                    {inv.status === "PAID" && inv.paidAt
                      ? t("paidOn", { date: date.format(inv.paidAt) })
                      : t("dueOn", { date: date.format(inv.dueDate) })}
                  </span>
                </div>
                {inv.status === "ISSUED" && (
                  <div className="flex flex-wrap gap-4">
                    <ActionForm
                      action={payInvoiceAction}
                      school=""
                      successMessage={t("paymentRecorded")}
                      className="flex-row flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <Field name="method" label={t("method")}>
                        <Select id={`method-${inv.id}`} name="method" defaultValue="TRANSFER">
                          {(["TRANSFER", "MOBILE_MONEY", "CHEQUE", "CASH"] as const).map((m) => (
                            <option key={m} value={m}>
                              {t(`methods.${m}`)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field name="reference" label={t("reference")}>
                        <Input id={`ref-${inv.id}`} name="reference" maxLength={80} className="w-36" />
                      </Field>
                      <SubmitButton size="sm">{t("recordPayment")}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={voidInvoiceAction} school="" className="flex-row flex-wrap items-end gap-2">
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <Field name="reason" label={t("voidReason")}>
                        <Input id={`reason-${inv.id}`} name="reason" maxLength={300} className="w-48" />
                      </Field>
                      <SubmitButton size="sm" variant="outline">
                        {t("void")}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("directors")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {data.directors.map((d) => (
              <p key={d.id}>
                <span className="font-medium">
                  {d.firstName} {d.lastName}
                </span>
                <span className="text-muted-foreground"> · {[d.phone, d.email].filter(Boolean).join(" · ")}</span>
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {data.history.length === 0 && <p className="text-muted-foreground">{t("noHistory")}</p>}
            {data.history.map((h) => (
              <p key={h.id}>
                <span className="text-muted-foreground text-xs">{dateTime.format(h.createdAt)}</span>{" "}
                {t.has(`actions.${h.action}`) ? t(`actions.${h.action}`) : h.action}
                {h.actor && <span className="text-muted-foreground"> — {h.actor.firstName}</span>}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
