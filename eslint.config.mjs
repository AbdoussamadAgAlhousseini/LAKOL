import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    // Isolation multi-tenant : le client Prisma brut (sans filtre d'école) n'est
    // autorisé que dans les couches qui en ont besoin. Le reste passe par
    // `ctx.db` (forSchool).
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/db/**",
      "src/server/auth/**",
      "src/server/platform/**",
      "src/server/context.ts",
      "src/app/**/(auth)/**",
      "src/app/**/spaces/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/server/db/client", message: "Utiliser ctx.db (forSchool) pour toute donnée d'école." },
            { name: "@prisma/client", importNames: ["PrismaClient"], message: "Utiliser ctx.db (forSchool)." },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
