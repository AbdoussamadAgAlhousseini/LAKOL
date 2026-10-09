import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { PwaSupport } from "@/components/layout/pwa";
import { ThemeProvider } from "@/components/layout/theme-provider";

export const metadata: Metadata = {
  title: { default: "LAKOL", template: "%s · LAKOL" },
  description: "Gestion scolaire : direction, professeurs, parents et élèves réunis.",
  applicationName: "LAKOL",
  appleWebApp: { capable: true, title: "LAKOL", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f766e" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1f2a" },
  ],
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
          <PwaSupport />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
