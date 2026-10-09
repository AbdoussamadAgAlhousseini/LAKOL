# LAKOL

Plateforme SaaS de gestion scolaire multi-écoles, pensée pour l'Afrique de l'Ouest francophone (Mali en priorité).
Direction, secrétariat, professeurs, parents et élèves travaillent dans un seul outil, chacun dans son espace.

> État : **les 8 phases du cahier des charges sont livrées** (fondations, structure et acteurs, pédagogie quotidienne, évaluations et bulletins, finances, communication, plateforme SaaS, finitions). Les améliorations prévues sont listées dans `TODO.md`, les choix dans `DECISIONS.md`, le cahier des charges dans `CLAUDE.md`.

## Prérequis

- Node.js 22 et pnpm 10 (`corepack enable`)
- Docker (pour PostgreSQL, Redis, MinIO, Mailpit), ou un PostgreSQL 16 local

## Installation

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL, Redis, MinIO, Mailpit
pnpm install                  # génère aussi le client Prisma
pnpm db:migrate               # applique les migrations
pnpm db:seed                  # données de démonstration (réinitialise la base)
pnpm dev                      # http://localhost:3000
pnpm worker                   # tâches de fond (avec REDIS_URL) : envois WhatsApp/email, rappels
```

Sans `REDIS_URL`, les tâches (envois, notifications) s'exécutent immédiatement dans l'application : pratique en développement. Les rappels de devoirs se lancent alors à la main avec `pnpm jobs:reminders` (ou par une tâche cron système).

## Comptes de démonstration

Les deux écoles de démonstration sont `les-etoiles` (Bamako, 30 élèves) et `le-savoir` (Sikasso, petite école servant aux tests d'isolation).

| Rôle                                                           | Identifiant                                             | Mot de passe  |
| -------------------------------------------------------------- | ------------------------------------------------------- | ------------- |
| Super admin plateforme                                         | `admin@lakol.test`                                      | `Admin2025!`  |
| Directeur                                                      | `directeur@les-etoiles.lakol.test` ou `70 00 00 10`     | `Lakol2025!`  |
| Secrétariat                                                    | `secretariat@les-etoiles.lakol.test`                    | `Lakol2025!`  |
| Censeur                                                        | `censeur@les-etoiles.lakol.test`                        | `Lakol2025!`  |
| Comptable                                                      | `comptable@les-etoiles.lakol.test`                      | `Lakol2025!`  |
| Professeur de maths (principal de 7e A)                        | `prof.maths@les-etoiles.lakol.test` ou `70 00 00 20`    | `Lakol2025!`  |
| Professeure de français (principale de 5e A **et** parent)     | `prof.francais@les-etoiles.lakol.test` ou `70 00 00 21` | `Lakol2025!`  |
| Parent de deux enfants (7e A et 9e A)                          | `70 00 00 01` ou `parent@lakol.test`                    | `Parent2025!` |
| Élève (Aminata Traoré, 7e A) — le matricule sert d'identifiant | `ETO-25-0029`                                           | `Eleve2025!`  |
| Directeur de l'école B                                         | `directeur@le-savoir.lakol.test`                        | `Lakol2025!`  |

Les numéros sont saisis au format local malien (8 chiffres) ou international (`+223…`).

Les nouveaux comptes (parents, personnel, élèves) reçoivent un mot de passe provisoire par WhatsApp. En développement, ce message s'affiche dans les logs du serveur ; il faut le changer à la première connexion.

Formulaire public de pré-inscription : http://localhost:3000/fr/inscription/les-etoiles

Créer une nouvelle école (essai gratuit de 30 jours, assistant de démarrage) : http://localhost:3000/fr/creer-mon-ecole

Application installable : sur Android, ouvrir le site dans Chrome puis « Installer l'application » (bouton de l'en-tête). Les pages déjà consultées (devoirs, emploi du temps, notes…) restent disponibles sans réseau.

Espace super admin (écoles, formules, factures) : http://localhost:3000/fr/admin. `les-etoiles` est en formule Premium, `le-savoir` en Standard.

## Scripts

| Commande                                                 | Rôle                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                 | Développement, build et serveur de production                        |
| `pnpm lint` / `pnpm typecheck` / `pnpm format`           | ESLint, TypeScript strict, Prettier                                  |
| `pnpm test:unit`                                         | Tests unitaires (sans base)                                          |
| `pnpm test:integration`                                  | Tests d'intégration (base migrée et seedée requise)                  |
| `pnpm test:e2e`                                          | Parcours Playwright (lance `pnpm start` : faire `pnpm build` avant)  |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:reset` | Base de données                                                      |
| `pnpm db:sync-permissions`                               | Après une mise à jour : ajoute les nouvelles permissions aux rôles   |
| `pnpm worker` / `pnpm jobs:flush`                        | Worker de la file de tâches / envoi des messages différés en attente |
| `pnpm jobs:subscriptions`                                | Cycle des abonnements (essais, renouvellements, impayés) à la main   |
| `pnpm icons`                                             | Régénère les icônes de l'application (PWA)                           |

## Variables d'environnement

Voir `.env.example`. En développement, WhatsApp et email sont simulés : les messages (dont les codes de vérification) s'affichent dans les logs du serveur.

| Variable                                        | Description                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                  | Connexion PostgreSQL                                                                     |
| `REDIS_URL`                                     | File de tâches (à partir de la phase 3)                                                  |
| `APP_URL`                                       | URL publique, pour les liens envoyés                                                     |
| `WHATSAPP_PROVIDER`                             | `mock` (défaut) ou `meta` (avec `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`)     |
| `ROOT_DOMAIN`                                   | Domaine principal (ex. `lakol.ml`) : `ecole-x.lakol.ml` mène à l'espace de l'école       |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | Webhook des statuts (`/api/webhooks/whatsapp`) : jeton de vérification et signature Meta |
| `EMAIL_PROVIDER`                                | `mock` (défaut) ou `resend` (avec `RESEND_API_KEY`, `EMAIL_FROM`)                        |
| `S3_*`                                          | Stockage de fichiers compatible S3 (MinIO en local, Cloudflare R2 en production)         |

## Déploiement

- **Docker** : `docker compose --profile app up -d --build` construit l'image (sortie _standalone_ de Next.js). Les migrations s'appliquent au démarrage.
- **Vercel / Railway** : base PostgreSQL managée, `pnpm db:deploy` au déploiement, variables de `.env.example`.

## Sauvegardes

- **Base** : `pg_dump` quotidien compressé, copié hors du serveur (bucket S3 avec versionnement), conservé 30 jours, plus un mensuel conservé 12 mois. Les bases managées (Railway, Neon, Supabase) ajoutent la restauration à un instant donné.
- **Fichiers** : versionnement activé sur le bucket S3.
- **Restauration testée** chaque trimestre sur une base vierge (`pg_restore`, puis `pnpm test:integration`).

## Documentation

- `ARCHITECTURE.md` : organisation du code, multi-tenant, RBAC, authentification
- `DECISIONS.md` : choix techniques et leurs raisons
- `TODO.md` : phases restantes et améliorations prévues
