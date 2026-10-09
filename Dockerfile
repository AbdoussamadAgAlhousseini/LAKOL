# Image de production (sortie « standalone » de Next.js).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S lakol && adduser -S lakol -G lakol
COPY --from=build /app/public ./public
COPY --from=build --chown=lakol:lakol /app/.next/standalone ./
COPY --from=build --chown=lakol:lakol /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
USER lakol
EXPOSE 3000
# Les migrations s'appliquent au démarrage (prisma migrate deploy).
CMD ["sh", "-c", "npx --yes prisma@6 migrate deploy && node server.js"]
