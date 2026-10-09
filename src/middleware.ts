import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { schoolFromHost } from "@/lib/subdomain";

const intl = createMiddleware(routing);

// Le middleware gère la langue et l'accès par sous-domaine. L'authentification
// et les droits sont vérifiés côté serveur à chaque requête (layouts et actions).
export default function middleware(request: NextRequest) {
  // `ecole-x.domaine` : l'accueil (/, /fr, /en) mène directement à l'espace de l'école.
  const school = schoolFromHost(request.headers.get("host"), process.env.ROOT_DOMAIN);
  if (school) {
    const { pathname } = request.nextUrl;
    const locale = routing.locales.find((l) => pathname === `/${l}` || pathname === `/${l}/`);
    if (pathname === "/" || locale) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale ?? routing.defaultLocale}/${school}/dashboard`;
      return NextResponse.redirect(url);
    }
  }
  return intl(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
