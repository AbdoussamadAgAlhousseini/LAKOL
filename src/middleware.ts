import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Le middleware ne gère que la langue. L'authentification et les droits sont
// vérifiés côté serveur à chaque requête (layouts et actions).
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
