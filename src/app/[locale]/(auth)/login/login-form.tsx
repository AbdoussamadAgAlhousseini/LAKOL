"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "../actions";

export function LoginForm({ locale, justReset }: { locale: string; justReset: boolean }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          {justReset && !state?.error && <Alert variant="success">{t("resetDone")}</Alert>}
          {state?.error && <Alert variant="destructive">{t(state.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="identifier">{t("identifier")}</Label>
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              inputMode="email"
              placeholder={t("identifierPlaceholder")}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" size="lg" disabled={pending}>
            {t("submit")}
          </Button>
          <Link href="/forgot-password" className="text-primary text-center text-sm underline-offset-4 hover:underline">
            {t("forgot")}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
