import { redirect } from "@/i18n/navigation";
import { getCurrentSession } from "@/server/auth/session";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getCurrentSession();
  redirect({ href: session ? "/spaces" : "/login", locale });
}
