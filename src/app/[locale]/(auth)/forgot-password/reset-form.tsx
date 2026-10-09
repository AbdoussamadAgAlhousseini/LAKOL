"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "../actions";

export function ResetForm({ locale }: { locale: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  const codeStep = state?.step === "code";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("resetTitle")}</CardTitle>
        <CardDescription>{t("resetSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          {state?.error && <Alert variant="destructive">{t(state.error)}</Alert>}
          {state?.success && !state.error && <Alert variant="success">{t(state.success)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="identifier">{t("identifier")}</Label>
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              placeholder={t("identifierPlaceholder")}
              defaultValue={state?.identifier}
              readOnly={codeStep}
              required
            />
          </div>
          {codeStep && (
            <>
              <input type="hidden" name="step" value="code" />
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">{t("code")}</Label>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">{t("newPassword")}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
              </div>
            </>
          )}
          <Button type="submit" size="lg" disabled={pending}>
            {codeStep ? t("resetSubmit") : t("sendCode")}
          </Button>
          <Link href="/login" className="text-primary text-center text-sm underline-offset-4 hover:underline">
            {t("backToLogin")}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
