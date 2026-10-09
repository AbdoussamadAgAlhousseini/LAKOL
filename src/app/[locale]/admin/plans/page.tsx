import { getTranslations } from "next-intl/server";
import { listPlans } from "@/server/platform/admin";
import { MODULE_KEYS } from "@/lib/modules";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updatePlanAction } from "../actions";

export default async function PlansPage() {
  const [t, tm, plans] = await Promise.all([getTranslations("admin"), getTranslations("modules"), listPlans()]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("nav.plans")} description={t("plansHint")} />
      {plans.map((p) => (
        <Card key={p.id} data-testid="plan">
          <CardHeader>
            <CardTitle>
              {p.name} <span className="text-muted-foreground text-sm font-normal">({p.code})</span>
            </CardTitle>
            <p className="text-muted-foreground text-sm">{t("planSchools", { count: p._count.subscriptions })}</p>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={updatePlanAction}
              school=""
              successMessage={t("saved")}
              className="grid gap-4 sm:grid-cols-4"
            >
              <input type="hidden" name="id" value={p.id} />
              <Field name="name" label={t("planName")}>
                <Input id={`name-${p.id}`} name="name" defaultValue={p.name} required />
              </Field>
              <Field name="pricePerStudent" label={t("pricePerStudentYear")}>
                <Input
                  id={`price-${p.id}`}
                  name="pricePerStudent"
                  type="number"
                  min={0}
                  defaultValue={p.pricePerStudent}
                />
              </Field>
              <Field name="maxStudents" label={t("maxStudents")} hint={t("emptyUnlimited")}>
                <Input
                  id={`max-${p.id}`}
                  name="maxStudents"
                  type="number"
                  min={1}
                  defaultValue={p.maxStudents ?? undefined}
                />
              </Field>
              <Field name="whatsappQuota" label={t("whatsappQuota")}>
                <Input id={`wa-${p.id}`} name="whatsappQuota" type="number" min={0} defaultValue={p.whatsappQuota} />
              </Field>
              <fieldset className="sm:col-span-4">
                <legend className="mb-2 text-sm font-medium">{t("modules")}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {MODULE_KEYS.map((m) => (
                    <label key={m} className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                      <input
                        type="checkbox"
                        name="modules[]"
                        value={m}
                        defaultChecked={p.modules.includes(m)}
                        className="accent-primary size-4"
                      />
                      {tm(m)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-3 text-sm sm:col-span-3">
                <input type="checkbox" name="isActive" defaultChecked={p.isActive} className="accent-primary size-5" />
                {t("planActive")}
              </label>
              <SubmitButton variant="outline" className="self-start">
                {t("save")}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
