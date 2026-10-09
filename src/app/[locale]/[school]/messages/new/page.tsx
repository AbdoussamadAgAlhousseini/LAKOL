import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadGuardedPage } from "@/server/page-context";
import { listContacts } from "@/server/services/messaging";
import { Composer } from "@/components/messaging/composer";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { startConversationAction } from "../actions";

export default async function NewMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; school: string }>;
  searchParams: Promise<{ q?: string; to?: string; student?: string }>;
}) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(school, locale, (c) => c.scope.permissions.has("message.send"));
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const [t, contacts] = await Promise.all([getTranslations("messages"), listContacts(ctx, q)]);
  const selected = sp.to
    ? contacts.find((c) => c.userId === sp.to && (c.studentId ?? "") === (sp.student ?? ""))
    : undefined;

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("new")} />
        <Card>
          <CardHeader>
            <CardTitle>{t("to", { name: selected.name })}</CardTitle>
            <p className="text-muted-foreground text-sm">{selected.detail}</p>
          </CardHeader>
          <CardContent>
            <Composer
              action={startConversationAction}
              school={school}
              fields={{ toUserId: selected.userId, ...(selected.studentId ? { studentId: selected.studentId } : {}) }}
              redirectTo={`/${school}/messages/{id}`}
            />
          </CardContent>
        </Card>
        <Link href={`/${school}/messages/new`} className="text-primary text-sm underline">
          {t("otherContact")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("new")} description={t("chooseContact")} />
      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          {t("search")}
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder={t("search")} className="h-12" />
        <Button type="submit" variant="outline" size="icon" className="size-12" aria-label={t("search")}>
          <Search />
        </Button>
      </form>
      <Card className="divide-y p-0" data-testid="contacts">
        {contacts.length === 0 && <p className="text-muted-foreground p-5 text-sm">{t("noContact")}</p>}
        {contacts.map((c) => (
          <Link
            key={`${c.userId}:${c.studentId ?? ""}`}
            href={`/${school}/messages/new?to=${c.userId}${c.studentId ? `&student=${c.studentId}` : ""}`}
            className="hover:bg-accent flex min-h-14 flex-col justify-center px-4 py-2"
          >
            <span className="font-medium">{c.name}</span>
            <span className="text-muted-foreground text-sm">{c.detail}</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
