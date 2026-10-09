import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage, loadOrDeny } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { studentAccount } from "@/server/services/finance/payments";
import { formatMoney } from "@/lib/money";
import { isoDate } from "@/lib/time";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AccountView } from "../../account-view";
import { FinanceNav } from "../../finance-nav";
import {
  addDiscountAction,
  addOptionalFeeAction,
  cancelInvoiceAction,
  cancelPaymentAction,
  recordPaymentAction,
  remindAction,
  removeDiscountAction,
} from "../../actions";

export default async function StudentFinancePage({
  params,
}: {
  params: Promise<{ locale: string; school: string; id: string }>;
}) {
  const { locale, school, id } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "finance.read"));
  if (!ctx) return <Forbidden />;
  const account = await loadOrDeny(studentAccount(ctx, id));
  if (!account) return <Forbidden />;
  const t = await getTranslations("finance");
  const s = account.student;
  const canPay = canAll(ctx.scope, "payment.write");
  const canCancel = canAll(ctx.scope, "payment.cancel");
  const canFees = canAll(ctx.scope, "fee.manage");
  const open = account.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const money = (v: number) => formatMoney(v, ctx.school.currency, locale);
  const optionalTypes = canFees
    ? await ctx.db.feeType.findMany({ where: { isOptional: true }, orderBy: { name: "asc" } })
    : [];
  const feeTypes = canFees ? await ctx.db.feeType.findMany({ orderBy: { name: "asc" } }) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${s.firstName} ${s.lastName}`}
        description={
          <>
            {s.matricule}
            {s.enrollments[0] && ` · ${s.enrollments[0].class.name}`} ·{" "}
            <Link href={`/${school}/students/${s.id}`} className="text-primary underline">
              {t("studentRecord")}
            </Link>
          </>
        }
        actions={
          account.overdue > 0 && (
            <ActionButton
              action={remindAction}
              school={school}
              fields={{ studentId: s.id, force: "on" }}
              confirm={t("remindConfirm")}
            >
              {t("remind")}
            </ActionButton>
          )
        }
      />
      <FinanceNav ctx={ctx} school={school} active="accounts" />

      {canPay && account.balance > 0 && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>{t("pay.title")}</CardTitle>
            <p className="text-muted-foreground text-sm">{t("pay.hint", { balance: money(account.balance) })}</p>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={recordPaymentAction}
              school={school}
              resetOnSuccess
              successMessage={t("pay.done")}
              className="grid gap-4 sm:grid-cols-3"
            >
              <input type="hidden" name="studentId" value={s.id} />
              <Field name="amount" label={t("pay.amount")}>
                <Input
                  id="amount"
                  name="amount"
                  inputMode="numeric"
                  required
                  placeholder="25 000"
                  className="text-lg"
                />
              </Field>
              <Field name="method" label={t("pay.method")}>
                <Select id="method" name="method" defaultValue="CASH">
                  {(["CASH", "CHEQUE", "TRANSFER"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`methods.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="reference" label={t("pay.reference")} hint={t("pay.referenceHint")}>
                <Input id="reference" name="reference" />
              </Field>
              <Field name="invoiceId" label={t("pay.invoice")}>
                <Select id="invoiceId" name="invoiceId" defaultValue="">
                  <option value="">{t("pay.oldestFirst")}</option>
                  {open.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label} — {money(i.total - i.amountPaid)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="guardianId" label={t("pay.payer")}>
                <Select id="guardianId" name="guardianId" defaultValue={s.guardians[0]?.guardianId ?? ""}>
                  <option value="">—</option>
                  {s.guardians.map((g) => (
                    <option key={g.guardianId} value={g.guardianId}>
                      {g.guardian.firstName} {g.guardian.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="paidAt" label={t("pay.date")}>
                <Input
                  id="paidAt"
                  name="paidAt"
                  type="date"
                  defaultValue={isoDate(new Date())}
                  max={isoDate(new Date())}
                />
              </Field>
              <SubmitButton size="lg" className="self-start">
                {t("pay.submit")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <AccountView
        account={account}
        school={school}
        locale={locale}
        currency={ctx.school.currency}
        actions={{
          invoice: (invoiceId) => {
            const inv = account.invoices.find((i) => i.id === invoiceId)!;
            return canCancel && inv.status === "UNPAID" ? (
              <details>
                <summary className="text-muted-foreground cursor-pointer text-xs">{t("cancelInvoice")}</summary>
                <ActionForm action={cancelInvoiceAction} school={school} className="mt-2 flex-row gap-2">
                  <input type="hidden" name="invoiceId" value={invoiceId} />
                  <Input name="reason" aria-label={t("reason")} placeholder={t("reason")} required className="h-9" />
                  <SubmitButton size="sm" variant="destructive">
                    {t("confirm")}
                  </SubmitButton>
                </ActionForm>
              </details>
            ) : null;
          },
          payment: (paymentId) =>
            canCancel ? (
              <details>
                <summary className="text-muted-foreground cursor-pointer text-xs">{t("cancelPayment")}</summary>
                <ActionForm
                  action={cancelPaymentAction}
                  school={school}
                  className="mt-2 flex-row gap-2"
                  confirm={t("cancelPaymentConfirm")}
                >
                  <input type="hidden" name="paymentId" value={paymentId} />
                  <Input name="reason" aria-label={t("reason")} placeholder={t("reason")} required className="h-9" />
                  <SubmitButton size="sm" variant="destructive">
                    {t("confirm")}
                  </SubmitButton>
                </ActionForm>
              </details>
            ) : null,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("discounts.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {account.discounts.length === 0 && <p className="text-muted-foreground text-sm">{t("discounts.none")}</p>}
            {account.discounts.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{t(`discounts.kinds.${d.kind}`)}</Badge>
                <span className="flex-1">
                  {d.label} — {d.percentBp ? `${d.percentBp / 100} %` : money(d.amount ?? 0)}
                  {d.feeType && ` (${d.feeType.name})`}
                </span>
                {canFees && (
                  <ActionButton action={removeDiscountAction} school={school} fields={{ id: d.id }} variant="ghost">
                    {t("remove")}
                  </ActionButton>
                )}
              </div>
            ))}
            {canFees && (
              <ActionForm
                action={addDiscountAction}
                school={school}
                resetOnSuccess
                className="grid gap-3 border-t pt-4 sm:grid-cols-2"
              >
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="kind" label={t("discounts.kind")}>
                  <Select id="kind" name="kind" defaultValue="SIBLING">
                    {(["SIBLING", "SCHOLARSHIP", "STAFF_CHILD", "EXCEPTIONAL"] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`discounts.kinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="label" label={t("discounts.label")}>
                  <Input id="discount-label" name="label" required />
                </Field>
                <Field name="percent" label={t("discounts.percent")}>
                  <Input id="percent" name="percent" inputMode="decimal" placeholder="10" />
                </Field>
                <Field name="amount" label={t("discounts.amount")}>
                  <Input id="discount-amount" name="amount" inputMode="numeric" />
                </Field>
                <Field name="feeTypeId" label={t("discounts.feeType")} className="sm:col-span-2">
                  <Select id="feeTypeId" name="feeTypeId" defaultValue="">
                    <option value="">{t("discounts.allFees")}</option>
                    {feeTypes.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <p className="text-muted-foreground text-xs sm:col-span-2">{t("discounts.hint")}</p>
                <SubmitButton size="sm" className="self-start">
                  {t("discounts.add")}
                </SubmitButton>
              </ActionForm>
            )}
          </CardContent>
        </Card>

        {canFees && optionalTypes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t("optional.title")}</CardTitle>
              <p className="text-muted-foreground text-sm">{t("optional.hint")}</p>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={addOptionalFeeAction}
                school={school}
                resetOnSuccess
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="feeTypeId" label={t("optional.type")}>
                  <Select id="opt-type" name="feeTypeId" defaultValue={optionalTypes[0].id}>
                    {optionalTypes.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="amount" label={t("optional.amount")}>
                  <Input id="opt-amount" name="amount" inputMode="numeric" required />
                </Field>
                <Field name="label" label={t("optional.label")}>
                  <Input id="opt-label" name="label" placeholder={t("optional.labelPlaceholder")} />
                </Field>
                <Field name="dueDate" label={t("optional.dueDate")}>
                  <Input id="opt-due" name="dueDate" type="date" defaultValue={isoDate(new Date())} />
                </Field>
                <SubmitButton size="sm" className="self-start">
                  {t("optional.add")}
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
