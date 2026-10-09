import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "@react-pdf/renderer", "bullmq", "ioredis"],
  // Pièces jointes (5 Mo) et messages vocaux (3 Mo) passent par les server actions (1 Mo par défaut).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default withNextIntl(nextConfig);
