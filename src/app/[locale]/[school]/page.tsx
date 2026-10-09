import { redirect } from "@/i18n/navigation";

export default async function SchoolIndex({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  redirect({ href: `/${school}/dashboard`, locale });
}
