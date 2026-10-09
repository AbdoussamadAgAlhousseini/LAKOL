import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { signUpAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signup"))("title") };
}

// Inscription d'une école en ligne : essai gratuit de 30 jours, sans carte ni paiement.
export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("signup");
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      <ActionForm action={signUpAction} school="" redirectTo="/{id}/onboarding">
        <Field name="schoolName" label={t("schoolName")}>
          <Input id="schoolName" name="schoolName" required maxLength={160} autoComplete="organization" />
        </Field>
        <Field name="city" label={t("city")}>
          <Input id="city" name="city" required maxLength={80} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field name="firstName" label={t("firstName")}>
            <Input id="firstName" name="firstName" required autoComplete="given-name" />
          </Field>
          <Field name="lastName" label={t("lastName")}>
            <Input id="lastName" name="lastName" required autoComplete="family-name" />
          </Field>
        </div>
        <Field name="phone" label={t("phone")} hint={t("phoneHint")}>
          <Input id="phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" />
        </Field>
        <Field name="email" label={t("email")}>
          <Input id="email" name="email" type="email" autoComplete="email" />
        </Field>
        <Field name="password" label={t("password")} hint={t("passwordHint")}>
          <Input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
        <Field name="confirm" label={t("confirm")}>
          <Input id="confirm" name="confirm" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="accept" required className="accent-primary mt-0.5 size-5 shrink-0" />
          {t("accept")}
        </label>
        <SubmitButton size="lg">{t("submit")}</SubmitButton>
      </ActionForm>
      <Link href="/login" className="text-primary text-center text-sm underline-offset-4 hover:underline">
        {t("haveAccount")}
      </Link>
    </div>
  );
}
