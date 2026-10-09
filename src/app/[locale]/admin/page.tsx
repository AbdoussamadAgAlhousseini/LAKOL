import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentSession } from "@/server/auth/session";
import { listSchoolsForPlatform } from "@/server/platform/schools";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Forbidden } from "@/components/layout/forbidden";
import { LogoutButton } from "@/components/layout/logout-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

// Espace super admin (complété en phase 7 : abonnements, modules, onboarding).
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const current = await getCurrentSession();
  if (!current) return redirect({ href: "/login", locale });
  if (!current.user.isPlatformAdmin) return <Forbidden />;

  const t = await getTranslations("admin");
  const schools = await listSchoolsForPlatform();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <LogoutButton locale={locale} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("schools")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-2 pr-4 font-medium">{t("schools")}</th>
                <th className="py-2 pr-4 font-medium">{t("plan")}</th>
                <th className="py-2 pr-4 font-medium">{t("status")}</th>
                <th className="py-2 text-right font-medium">{t("students")}</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-3 pr-4">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {s.slug}
                      {s.city ? ` · ${s.city}` : ""}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{s.plan}</td>
                  <td className="py-3 pr-4">
                    {s.status && <Badge variant={s.status === "ACTIVE" ? "success" : "warning"}>{s.status}</Badge>}
                  </td>
                  <td className="py-3 text-right tabular-nums">{s.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
