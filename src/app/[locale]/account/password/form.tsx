"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "../../(auth)/actions";

export function ChangePasswordForm({ locale, forced }: { locale: string; forced: boolean }) {
  const t = useTranslations("account");
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{forced ? t("forcedIntro") : t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          {state?.error && <Alert variant="destructive">{t(state.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="current">{forced ? t("temporaryPassword") : t("currentPassword")}</Label>
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("newPassword")}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            <p className="text-muted-foreground text-xs">{t("hint")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">{t("confirmPassword")}</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          <Button type="submit" size="lg" disabled={pending}>
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
