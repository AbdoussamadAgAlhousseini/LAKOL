# Images de production de LAKOL.
#   runner : application web (sortie « standalone » de Next.js, utilisateur non root)
#   tools  : worker des tâches de fond, migrations et scripts (pnpm db:deploy, platform:init…)
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Derrière un proxy d'entreprise, ses certificats racine se passent en secret de
# construction (jamais copiés dans l'image) :
#   docker build --secret id=extra_ca,src=/chemin/ca.crt …
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=secret,id=extra_ca \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN --mount=type=secret,id=extra_ca \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm prisma generate && pnpm build

# Worker et scripts d'exploitation : code source + tsx + CLI Prisma.
FROM build AS tools
ENV NODE_ENV=production
RUN addgroup -S lakol && adduser -S lakol -G lakol && mkdir -p /data/storage && chown -R lakol:lakol /data
USER lakol
CMD ["pnpm", "worker"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S lakol && adduser -S lakol -G lakol && mkdir -p /data/storage && chown -R lakol:lakol /data
COPY --from=build /app/public ./public
COPY --from=build --chown=lakol:lakol /app/.next/standalone ./
COPY --from=build --chown=lakol:lakol /app/.next/static ./.next/static
USER lakol
EXPOSE 3000
# Les migrations sont appliquées par le service « migrate » (image tools) avant le démarrage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
