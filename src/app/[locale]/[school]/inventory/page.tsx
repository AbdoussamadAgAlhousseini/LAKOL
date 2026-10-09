import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { listItems } from "@/server/services/modules/inventory";
import { cn } from "@/lib/utils";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { moveStockAction, saveItemAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inventory"))("title") };
}

export default async function InventoryPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => canAll(c.scope, "inventory.manage"));
  if (!ctx) return <Forbidden />;
  const [t, items] = await Promise.all([getTranslations("inventory"), listItems(ctx)]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: ctx.school.timezone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("hint")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("newItem")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={saveItemAction}
            school={school}
            resetOnSuccess
            successMessage={t("saved")}
            className="grid gap-3 sm:grid-cols-5"
          >
            <Field name="name" label={t("name")} className="sm:col-span-2">
              <Input id="name" name="name" required maxLength={120} placeholder={t("namePlaceholder")} />
            </Field>
            <Field name="category" label={t("category")}>
              <Input id="category" name="category" maxLength={60} />
            </Field>
            <Field name="unit" label={t("unit")}>
              <Input id="unit" name="unit" required maxLength={20} defaultValue={t("defaultUnit")} />
            </Field>
            <Field name="minQuantity" label={t("minQuantity")}>
              <Input id="minQuantity" name="minQuantity" type="number" min={0} defaultValue={0} />
            </Field>
            <SubmitButton className="self-start">{t("add")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2" data-testid="items">
        {items.length === 0 && <p className="text-muted-foreground text-sm">{t("empty")}</p>}
        {items.map((item) => {
          const low = item.quantity <= item.minQuantity;
          return (
            <Card key={item.id} className={cn(low && "border-warning")} data-testid="item">
              <CardHeader className="flex-row items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-base">{item.name}</CardTitle>
                  {item.category && <p className="text-muted-foreground text-xs">{item.category}</p>}
                </div>
                <p className={cn("text-right text-xl font-bold tabular-nums", low && "text-warning-foreground")}>
                  {item.quantity}
                  <span className="text-muted-foreground block text-xs font-normal">{item.unit}</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {low && (
                  <p className="text-warning-foreground flex items-center gap-1 text-xs font-medium">
                    <AlertTriangle className="size-4" aria-hidden /> {t("lowStock", { min: item.minQuantity })}
                  </p>
                )}
                <ActionForm action={moveStockAction} school={school} resetOnSuccess className="grid grid-cols-3 gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <Field name="direction" label={t("movement")}>
                    <Select id={`dir-${item.id}`} name="direction" defaultValue="OUT">
                      <option value="OUT">{t("out")}</option>
                      <option value="IN">{t("in")}</option>
                    </Select>
                  </Field>
                  <Field name="quantity" label={t("quantity")}>
                    <Input id={`qty-${item.id}`} name="quantity" type="number" min={1} defaultValue={1} />
                  </Field>
                  <Field name="reason" label={t("reason")}>
                    <Input id={`reason-${item.id}`} name="reason" required maxLength={200} />
                  </Field>
                  <SubmitButton size="sm" variant="outline" className="col-span-3 self-start">
                    {t("record")}
                  </SubmitButton>
                </ActionForm>
                {item.movements.length > 0 && (
                  <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                    {item.movements.map((m) => (
                      <li key={m.id}>
                        {when.format(m.createdAt)} ·{" "}
                        <span className={m.delta > 0 ? "text-success" : ""}>
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </span>{" "}
                        · {m.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
