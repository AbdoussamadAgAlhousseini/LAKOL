import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { logoutAction } from "@/app/[locale]/(auth)/actions";
import { Button } from "@/components/ui/button";

export async function LogoutButton({ locale, className }: { locale: string; className?: string }) {
  const t = await getTranslations("common");
  return (
    <form action={logoutAction} className={className}>
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="ghost">
        <LogOut aria-hidden />
        {t("logout")}
      </Button>
    </form>
  );
}
