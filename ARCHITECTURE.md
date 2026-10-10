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

## Modules métier (phase 2)

- **Services** (`src/server/services/`) : `structure`, `students` (dont tuteurs, comptes élèves, documents), `staff`, `import`, `preregistrations`, `settings`, `accounts` (création / réutilisation des comptes, rôles, envoi des accès), `notify` (notification in-app + WhatsApp/email tracés dans `NotificationDelivery`). Ils reçoivent un `ServiceContext` (client d'école, utilisateur, droits) et ne dépendent pas de Next.js : les tests d'intégration les appellent directement.
- **Actions** : un fichier `actions.ts` par module dans `src/app/[locale]/[school]/…`, chaque action passant par `schoolAction` (droits + validation Zod). Les erreurs métier (`DomainError`) sont renvoyées comme clés de traduction.
- **Formulaires** : `ActionForm` / `Field` / `SubmitButton` (`src/components/forms`) gèrent l'envoi, les erreurs par champ et la redirection.
- **Fichiers** : adapter `StorageProvider` (local ou S3), lecture via `/api/files/[id]` avec contrôle d'accès.
- **Pages publiques** : pré-inscription (`/{langue}/inscription/{école}`), via `src/server/platform/preregistration.ts`.

## Tâches de fond et notifications (phase 3)

- `notifyUser` / `notifyGuardians` (`services/notify.ts`) créent la notification in-app et une `NotificationDelivery` (QUEUED), puis mettent en file `delivery.send`. Le worker envoie et passe le suivi à SENT (ou FAILED après 4 tentatives, avec reprise exponentielle).
- Sans `REDIS_URL`, `enqueue` exécute la tâche immédiatement (développement, tests).
- Tâche planifiée `homework.reminders` (toutes les heures) : devoirs dus dans les 24 h, un message regroupé par élève, un seul rappel par devoir.
- Canaux : WhatsApp pour ce qui est urgent ou important (absence, annulation de cours, sanction, accès) ; in-app seulement pour le quotidien (nouveau devoir, correction) afin de limiter le volume de messages.

## Pédagogie (phase 3)

- **Emploi du temps** : créneaux par classe ; le professeur est celui affecté à la matière ; conflits classe / professeur / salle refusés ; exceptions datées (annulation, remplacement) notifiées aux parents.
- **Appel** : feuille par classe et par créneau (ou journée). Le composant client garde l'appel dans `localStorage` sans réseau et le renvoie à l'évènement `online` ; chaque ligne porte un `clientId` unique, ce qui rend le renvoi idempotent. Le parent d'un élève nouvellement absent est prévenu une seule fois (`parentNotifiedAt`).
- **Devoirs** : publication par le professeur affecté, pièces jointes (`Document` « Homework »), rendu en ligne (« HomeworkSubmission »), correction notée en centièmes ; vue famille par enfant ; charge de travail sur 14 jours.
- **Justificatifs** : le parent dépose un motif et une pièce ; la vie scolaire valide (statut EXCUSED, audité).

## Évaluations et bulletins (phase 4)

- **Calculs** (`src/lib/grading.ts`, fonctions pures testées) : note ramenée au barème de l'école, moyenne de matière pondérée par le poids des évaluations (absences ignorées), moyenne générale coefficientée (coefficients du niveau et de la série ; 1 par défaut), rangs avec ex æquo, moyenne de classe, plus forte et plus faible, distinction proposée (16 / 14 / 12 sur 20).
- **Cycle de vie** : le professeur affecté crée l'évaluation et saisit (grille ou import Excel « matricule ; note ») → la direction valide classe × période (`Assessment.isLocked`) → toute modification ultérieure exige `grade.unlock` et est tracée → appréciations (matière : professeur ; générale : professeur principal) et conseil de classe → édition des PDF (`@react-pdf/renderer`, côté serveur, stockés comme `Document` « ReportCard ») → publication et notification des parents.
- **Accès aux bulletins** : personnel de la classe ; famille seulement si publié, si le tuteur peut voir les notes (`StudentGuardian.canViewGrades`) et si l'école ne bloque pas pour impayé échu (`School.blockReportIfUnpaid`).
- **Carte scolaire** : PDF format carte bancaire avec photo et QR code (`/api/schools/{école}/students/{id}/card`).

## Finances (phase 5)

- **Grilles** (`FeeSchedule`) par niveau (ou tous niveaux), avec échéances calculées selon la fréquence (unique, mensuelle, par trimestre, annuelle). Frais facultatifs (cantine, transport…) facturés à la demande.
- **Échéanciers** : `generateInvoices` crée une facture par échéance et par élève, réductions comprises (lignes négatives). La clé `Invoice.sourceKey` (« grille:échéance ») rend la génération idempotente.
- **Paiements** faits à l'école (espèces, chèque, virement) : répartis sur les factures les plus anciennes (`PaymentAllocation`), trop-perçu refusé, reçu numéroté sans trou (`Counter` dans la même transaction). Annulation par un profil autorisé : factures rouvertes, reçu marqué « ANNULÉ », audit.
- **Reçus PDF** générés à la demande (`/api/schools/{école}/receipts/{paiement}`), montant en toutes lettres.
- **Relances** : tâche quotidienne `finance.reminders`, au plus une relance par semaine et par élève, envoyée seulement aux tuteurs autorisés à voir les frais (`StudentGuardian.canViewFinance`).
- **Caisse** : mouvements du jour par mode, espèces attendues, clôture (`CashClosing`) avec écart justifié.
- **Paie** : fiches mensuelles (salaire de base, heures de vacation × taux, primes, retenues) ; le paiement crée une dépense « Salaires ».
- **Paiement mobile** : interface `PaymentProvider` (`adapters/payment`) prête ; seul le fournisseur « manual » est actif.

## Communication (phase 6)

- **Messagerie** (`services/messaging.ts`) : conversations à deux, rattachées à un élève quand c'est un échange parent ↔ professeur. Contacts autorisés : le parent écrit aux professeurs et au professeur principal des classes de ses enfants, et à l'administration ; le professeur écrit au personnel et aux parents de ses élèves ; l'administration écrit à tous. Pas de messagerie entre parents. Messages vocaux (MediaRecorder, 3 Mo max) stockés comme `Document` « Message », lisibles par les participants seulement.
- **Modération** : un participant signale un message ; la direction voit uniquement ce message (pas la conversation) et peut le masquer (audité).
- **Annonces et circulaires** : public (école, parents, personnel, niveaux, classes) résolu à la publication ; une notification par destinataire (`Notification.refType = "Announcement"`), qui sert aussi de droit de lecture ; accusé de lecture (`AnnouncementAck`), suivi et relance des retardataires.
- **Notifications** : in-app toujours ; WhatsApp/email selon le cas. **Heures calmes** de l'école (20 h – 7 h par défaut, fuseau `School.timezone`) : les envois non urgents sont programmés (`NotificationDelivery.scheduledFor`, délai BullMQ) ; absences, annulations de cours et envois d'accès restent immédiats. Tâche `deliveries.flush` toutes les 10 min en filet de sécurité.
- **Suivi des envois** : webhook WhatsApp (`/api/webhooks/whatsapp`, signature HMAC vérifiée) → SENT / DELIVERED / READ / FAILED, sans retour en arrière ; page de suivi et renvoi des échecs.
- **Temps réel** : flux SSE `/api/schools/{école}/events` (compteurs de notifications et de messages non lus toutes les 5 s, reconnexion automatique après 5 min).
- **Rendez-vous** : le professeur publie des séries de créneaux (`MeetingSlot`, chevauchements refusés) ; le parent réserve un créneau d'un professeur de son enfant (mise à jour atomique : un créneau ne se réserve qu'une fois) ; chaque partie est prévenue des réservations et annulations.

## Plateforme SaaS (phase 7)

- **Formules** (`Plan`) : prix par élève et par an, élèves maximum, quota WhatsApp mensuel, modules inclus. Le super admin peut fixer des conditions particulières par école (`Subscription.maxStudents`, `pricePerStudent`, `whatsappQuota`).
- **Modules activables** : actifs = modules de la formule (sauf désactivés par l'école) + modules offerts par la plateforme (`ModuleActivation.grantedByPlatform`). Au chargement du contexte, les permissions des modules inactifs sont retirées (`permissionsForModules`) : menus, pages, actions et services sont coupés au même endroit, sans contrôle dispersé.
- **Limites** : inscription refusée au-delà des élèves autorisés (création, import tout-ou-rien, pré-inscription, réinscription) ; au-delà du quota WhatsApp du mois, l'envoi passe par email ou reste in-app (les messages urgents passent toujours).
- **Cycle de vie** (tâche `subscriptions.check`, chaque nuit) : essai → rappel à J-7 → formule gratuite à la fin (données conservées) ; formule payante → facture de renouvellement 30 jours avant l'échéance → impayé avec 15 jours de grâce → suspension en lecture seule. Le règlement d'une facture réactive l'abonnement pour la période facturée. Chaque transition prévient la direction (une seule fois, `lastNoticeKey`).
- **Factures de la plateforme** (`PlatformInvoice`) : numérotation LAK-AAAA-NNNNN sans trou (verrou de transaction), élèves inscrits × prix, PDF (`/api/platform-invoices/{id}`, super admin ou direction de l'école), paiement enregistré par le super admin.
- **Espace super admin** (`/admin`) : tableau de bord (écoles, élèves, revenu annuel, encaissements, impayés, essais qui finissent), écoles (création, formule, conditions, essai, suspension, modules, factures, historique audité), formules, factures.
- **Création d'école** (`platform/onboarding.ts`) : en ligne (`/creer-mon-ecole`, essai Standard de 30 jours, limité par adresse IP) ou par le super admin (accès du directeur envoyés par WhatsApp). Rôles système, site principal et abonnement créés d'un coup.
- **Assistant de démarrage** (`/[école]/onboarding`) : coordonnées, année scolaire, structure du système malien en un clic (`lib/school-templates.ts` : cycles, niveaux, séries, matières, coefficients, une classe par niveau), import des élèves, professeurs. L'état est déduit des données ; la direction peut l'ignorer.
- **Sous-domaines** : avec `ROOT_DOMAIN`, `ecole-x.domaine` redirige vers `/fr/ecole-x/dashboard` (middleware) ; les URL avec le chemin de l'école restent valables partout.

## Finitions (phase 8)

- **PWA** : manifeste (`src/app/manifest.ts`, icônes générées par `pnpm icons`), service worker `public/sw.js`. Pages consultables (accueil, devoirs, emploi du temps, appel, notes, annonces, cantine, transport…) en « réseau d'abord » avec copie locale ; fichiers de Next.js en « cache d'abord » ; pièces jointes déjà ouvertes disponibles hors ligne ; page `offline.html` pour une page jamais ouverte. Le cache des pages est vidé au retour sur la page de connexion (déconnexion, autre utilisateur). L'appel hors ligne reste géré par l'écran d'appel (phase 3).
- **Tableaux de bord avancés** (`services/dashboard.ts`) : direction (alertes : absences répétées, élèves sous la moyenne, impayés, stocks, livres en retard ; taux de présence sur 8 semaines ; moyenne par classe), professeur (travaux à corriger), famille (moyenne générale par période). Graphiques SVG rendus côté serveur (`components/charts.tsx`) : une série, couleur de l'école, info-bulle native et tableau pour lecteurs d'écran.
- **Modules optionnels** (`services/modules/*`) : cantine (inscrits, menus, vue famille), transport (circuits, arrêts, capacité, vue famille), bibliothèque (catalogue, prêts, retours, retards), infirmerie (passages ; parents prévenus si l'élève rentre ou doit consulter), stocks (entrées/sorties sans stock négatif, seuil d'alerte). Chacun dépend de son module et de sa permission.
- **Ressources pédagogiques** : par matière et niveau (fichier ou lien) ; le professeur publie dans ses matières ; familles et élèves voient les ressources de leurs niveaux.
- **Exports Excel** (`services/exports.ts`, `/api/schools/{école}/exports/{type}`) : élèves, impayés, paiements d'une période, assiduité, résultats d'une classe. Mêmes droits que les pages.
- **Performances** : images compressées à l'envoi (WebP, 1600 px max) ; pages légères (composants serveur, graphiques sans bibliothèque) ; pagination des listes ; BullMQ et ioredis hors du bundle.

## Exploitation (production)

- **Images** (`Dockerfile`) : `runner` (sortie standalone de Next.js, utilisateur non root, sonde de santé) et `tools` (worker, migrations, scripts ; dépendances de production seulement). Les polices de pdfkit sont ajoutées explicitement au traçage de la sortie standalone (`outputFileTracingIncludes`).
- **Pile** (`docker-compose.prod.yml`) : Caddy (HTTPS automatique ; certificats des sous-domaines à la demande, accordés par `/api/tls-check` aux seules écoles existantes), app, worker, `migrate` (migrations + `platform:init` avant chaque démarrage), PostgreSQL, Redis persistant (`appendonly`), `backup`.
- **Démarrage** : `instrumentation.ts` et le worker vérifient la configuration (`server/env.ts`) ; en `DEPLOY_ENV=production`, une configuration incomplète arrête le processus.
- **WhatsApp** : toutes les notifications et les codes passent par le modèle approuvé par Meta (`{{1}}` titre, `{{2}}` message, `{{3}}` lien), dans la langue du destinataire.
- **Sécurité HTTP** : CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (micro pour les messages vocaux uniquement).
- **CI** : vérifications, tests, construction des images à chaque commit, publication sur GHCR pour les versions taguées.

## Services externes

Interfaces dans `src/server/adapters/` :

- `WhatsAppProvider` : mock ou Meta Cloud API ;
- `EmailProvider` : mock ou Resend.

Le fournisseur se choisit par variable d'environnement. Un `PaymentProvider` (mobile money) se branchera sur `Payment.provider` / `providerRef` sans refonte.
