# Architecture de LAKOL

## Vue d'ensemble

Une seule application Next.js (App Router) sert l'interface et le serveur. PostgreSQL stocke les données via Prisma.
À partir de la phase 3, un processus _worker_ séparé (BullMQ + Redis) gérera les envois WhatsApp/email, les PDF et les rappels.

```
src/
├─ app/[locale]/
│  ├─ (auth)/             connexion, mot de passe oublié, actions d'authentification
│  ├─ spaces/             choix de l'espace (école × rôle)
│  ├─ admin/              super admin plateforme
│  └─ [school]/           espace d'une école (le segment = slug de l'école)
│     ├─ layout.tsx       charge le contexte (droits) et affiche la navigation du rôle
│     ├─ dashboard/       tableau de bord adapté au rôle
│     └─ [...section]/    modules pas encore livrés (page « bientôt disponible »)
├─ server/
│  ├─ db/                 client Prisma brut, extension tenant, séquences
│  ├─ auth/               sessions, mots de passe, limitation, codes de vérification
│  ├─ rbac/               catalogue des permissions, rôles par défaut, policies
│  ├─ adapters/           WhatsApp, email (interfaces + mocks + fournisseurs réels)
│  ├─ services/           logique métier (sans interface)
│  ├─ platform/           requêtes du super admin (toutes écoles)
│  ├─ context.ts          contexte d'une école pour l'utilisateur connecté
│  ├─ action.ts           wrapper des actions serveur d'une école
│  └─ audit.ts            journal d'audit
├─ components/ui/         composants de base (format shadcn/ui)
├─ components/layout/     coquille, navigation, thème, langue
├─ lib/                   fonctions pures : téléphone, argent, notes
├─ i18n/, messages/       next-intl ; une langue = un fichier JSON
prisma/                   schéma, migrations, seed
tests/unit, integration, e2e
```

## Multi-tenant

- **Base partagée** : chaque table métier porte `schoolId`. Les tables globales sont `Plan`, `School`, `User`, `Session`, `VerificationCode`, `LoginAttempt` et `Permission`.
- **Filtrage centralisé** : `forSchool(schoolId)` (`src/server/db/tenant.ts`) renvoie un client Prisma étendu qui :
  - ajoute `schoolId` à tous les `where` (lectures, comptages, agrégats, mises à jour, suppressions) ;
  - impose `schoolId` à toutes les créations ;
  - lève `TenantViolationError` si une écriture vise une autre école.
- Les pages et actions reçoivent `ctx.db` (déjà filtré). **ESLint interdit** d'importer le client brut hors de `server/db`, `server/auth`, `server/platform` et du code d'authentification.
- **Règle pour les services** : avant de lier une entité par son id (ex. inscrire un élève dans une classe), la charger via `ctx.db`. Un id d'une autre école renvoie alors « introuvable ». Les écritures imbriquées (`create` dans `create`) doivent fournir `schoolId` elles-mêmes.
- **Résolution de l'école** : par le chemin `/{langue}/{slug}/…`. Les sous-domaines sont prévus (voir `TODO.md`).
- **Utilisateurs globaux** : `User` n'appartient à aucune école. L'appartenance passe par `UserRole(userId, roleId, schoolId)`. Un parent peut ainsi avoir des enfants dans deux écoles, et un professeur être aussi parent.
- Les tests `tests/integration/tenant-isolation.test.ts` et e2e vérifient l'isolation.

## Rôles et permissions

- Les **permissions** sont des constantes (`src/server/rbac/permissions.ts`), copiées dans la table `Permission`.
- Les **rôles** sont définis par école (`Role`). Les 11 rôles système sont créés avec leurs permissions par défaut, et une école peut en ajouter.
- Le suffixe **`:own`** limite une permission au périmètre de l'utilisateur :
  - pour un professeur, ses classes (affectations et classes dont il est principal) et leurs élèves ;
  - pour un parent, ses enfants ;
  - pour un élève, lui-même.
- **Policies** (`policies.ts`) : `can`, `canAll`, `canOnClass`, `canOnStudent` et leurs variantes `require*`, qui lèvent `ForbiddenError`.
- **Espace actif** : un utilisateur à plusieurs rôles choisit un espace. Seules les permissions du rôle actif s'appliquent (moindre privilège), et la navigation suit ce rôle.
- **Actions serveur** : `schoolAction({ schema, permission }, handler)` enchaîne la session, l'école, le contrôle d'abonnement (lecture seule si suspendu), la validation Zod et la permission. Le périmètre fin (`requireClassAccess`…) se vérifie dans le handler.
- **Audit** : `audit(ctx.db, actor, { action, entityType, entityId, before, after })` pour toute action sensible.

## Authentification

- Identifiant = **email ou téléphone** (normalisé en E.164, Mali par défaut) + mot de passe **argon2id**.
- **Sessions en base** : le cookie httpOnly contient un jeton aléatoire, et la base n'en stocke que le SHA-256. Une session dure 30 jours, prolongée automatiquement.
- **Limitation** : 5 échecs par identifiant ou 30 par IP sur 15 minutes. Le temps de réponse est identique, que le compte existe ou non.
- **Réinitialisation** : code à 6 chiffres envoyé par WhatsApp (sinon email), valable 10 min, 5 essais. Toutes les sessions sont révoquées après le changement.
- **CSRF** : les Server Actions de Next.js vérifient l'origine, et le cookie est `SameSite=Lax`.

## Données

- Montants en **entiers** (unités mineures : 1 = 1 FCFA). Notes en **centièmes** avec le barème dans `outOf`. Heures en minutes depuis minuit.
- Suppression logique (`deletedAt`) sur les élèves, tuteurs, personnel, notes, paiements, factures, documents, messages.
- Numérotation sans trou (matricules, factures, reçus) via `Counter`, incrémenté dans la transaction de création.
- Pièces jointes : table `Document` polymorphe (`entityType`, `entityId`), fichiers sur S3.

## Services externes

Interfaces dans `src/server/adapters/` :

- `WhatsAppProvider` : mock ou Meta Cloud API ;
- `EmailProvider` : mock ou Resend.

Le fournisseur se choisit par variable d'environnement. Un `PaymentProvider` (mobile money) se branchera sur `Payment.provider` / `providerRef` sans refonte.
