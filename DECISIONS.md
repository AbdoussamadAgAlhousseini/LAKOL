# Décisions techniques

Format : contexte, décision, conséquences.

## 001 — Stack

Stack recommandée retenue : Next.js 15 (App Router), TypeScript strict, Tailwind CSS 4, Prisma 6, PostgreSQL 16, Zod, Vitest, Playwright.
Prisma 6 plutôt que 7 : la v7 change la configuration (fichier `prisma.config.ts`, adapters obligatoires) sans bénéfice pour nous aujourd'hui.

## 002 — Authentification maison plutôt qu'Auth.js ou Lucia

Lucia est abandonné depuis 2025. Le mode « identifiants » d'Auth.js se prête mal aux sessions en base, à la connexion par téléphone et aux codes WhatsApp.
Décision : sessions en base (jeton haché en SHA-256, cookie httpOnly), mots de passe argon2id (`@node-rs/argon2`, binaire précompilé, aucune compilation native).
Conséquence : environ 200 lignes maîtrisées et testées, sans dépendance à un framework d'auth.

## 003 — Multi-tenant : base partagée + extension Prisma

Une base par école multiplierait le coût et compliquerait les migrations.
Décision : colonne `schoolId` et extension Prisma `forSchool()` qui filtre toutes les opérations, plus une règle ESLint qui interdit le client brut.
Conséquences :

- les écritures imbriquées ne sont pas réécrites (règle documentée) ;
- le Row-Level Security PostgreSQL est prévu en défense supplémentaire (TODO).

## 004 — Utilisateurs globaux, rôles par école

`User` n'a pas de `schoolId`, et l'appartenance passe par `UserRole`.
Cela permet un parent dans plusieurs écoles et des rôles multiples (professeur et parent). La table `Membership` envisagée dans le plan a été fusionnée dans `UserRole`, qui porte `schoolId`.

## 005 — Permissions `:own` et espace actif

Les permissions vont par paires : `grade.read` (toute l'école) et `grade.read:own` (son périmètre). Seules les permissions du rôle actif s'appliquent.
On obtient ainsi un modèle simple, testable sans base, et un moindre privilège quand un utilisateur cumule des rôles.

## 006 — École résolue par le chemin

`/{langue}/{slug}/…` fonctionne partout sans DNS joker, en local comme en production. Le sous-domaine sera réécrit vers ce chemin par le middleware (phase 7, avec l'onboarding).

## 007 — Composants shadcn/ui écrits à la main

Le registre shadcn (ui.shadcn.com) était inaccessible depuis l'environnement de développement.
Les composants de base (Button, Input, Label, Card, Badge, Alert) ont été écrits au format shadcn, avec les mêmes API et jetons de couleur. Les suivants pourront être ajoutés via `pnpm dlx shadcn add` quand le registre est accessible.

## 008 — Interface légère pour mobiles d'entrée de gamme

- Le menu mobile utilise `<details>`, sans JavaScript.
- Pas de police web : polices système.
- Le sélecteur de langue est un `<select>` natif.
- Les cibles tactiles font 48 px.
- Les tuiles du tableau de bord parent ont des codes couleur (vert / orange / rouge) et des icônes, pour limiter le texte.

## 009 — Montants et notes en entiers

L'argent est stocké en entiers (unités mineures). Les notes sont en centièmes, avec le barème (`outOf`) sur l'évaluation, ce qui donne des moyennes et des rangs déterministes, sans flottants.

## 010 — Seed déterministe

Le seed vide la base puis la remplit avec un générateur pseudo-aléatoire à graine fixe. Les tests d'intégration et e2e s'appuient sur ces données.

## 011 — Tâches de fond reportées à la phase 3

En phase 1, le seul envoi est le code de réinitialisation, fait de façon synchrone. BullMQ + Redis arrivent avec les notifications d'absence (phase 3) et seront généralisés en phase 6.

## 012 — Élèves : connexion par matricule

Beaucoup d'élèves n'ont ni téléphone ni email. Le champ `User.username` reçoit le matricule en minuscules ; l'écran de connexion accepte email, téléphone ou matricule. Les accès d'un élève sont envoyés à son parent principal.

## 013 — Comptes parents partagés entre écoles

Un parent garde un seul compte (identifié par son téléphone) même si ses enfants sont dans plusieurs écoles. Une école ne peut pas réinitialiser le mot de passe d'un compte qui sert ailleurs : le parent utilise « Mot de passe oublié ». Un mot de passe provisoire impose un changement à la première connexion.

## 014 — Rôle de direction protégé

Attribuer des rôles exige `user.manage` ; attribuer ou retirer le rôle de direction exige en plus `role.manage` (direction uniquement), pour empêcher toute élévation de privilèges par le secrétariat. Le rôle « professeur principal » suit automatiquement l'attribution des classes.

## 015 — Formulaires sans dépendance

Les formulaires utilisent un composant `ActionForm` maison (FormData → action serveur, erreurs par champ et erreurs métier traduites) plutôt qu'une bibliothèque de formulaires, pour garder des pages légères. Les erreurs métier (`DomainError`) portent une clé de traduction.

## 016 — Fichiers : stockage local en développement, S3 en production

`STORAGE_PROVIDER=local` écrit dans `./storage` ; `s3` vise tout stockage compatible (R2, MinIO…). Les fichiers sont servis par `/api/files/[id]` après contrôle d'accès (périmètre de l'élève, appartenance à l'école), jamais par une URL publique.

## 017 — Import Excel en deux temps

Le fichier est d'abord vérifié ligne par ligne (classe inconnue, téléphone invalide, doublon…) sans rien écrire ; l'import n'est possible que si toutes les lignes sont valides. Formats : .xlsx (exceljs) et CSV (séparateur « ; » ou « , »).

## 018 — Pré-inscription publique

Formulaire sans compte sur `/{langue}/inscription/{école}`, limité à 10 demandes par heure et par IP, avec un champ piège contre les robots. La validation par l'école crée l'élève, le parent et son compte comme une inscription normale.

## 019 — Appel hors ligne simple (localStorage)

En attendant la PWA complète (phase 8), l'écran d'appel garde les appels non envoyés dans `localStorage` et les renvoie au retour du réseau. Les `clientId` uniques évitent tout doublon côté serveur. Limite : l'écran doit avoir été chargé avant la coupure (le cache hors ligne des pages arrive en phase 8).

## 020 — Heures en UTC

Les dates et heures (emploi du temps, date limite des devoirs) sont stockées et affichées en UTC, ce qui correspond à l'heure légale du Mali, du Sénégal, de la Guinée et du Burkina Faso. Pour un pays sur un autre fuseau, il faudra appliquer `School.timezone` (champ déjà prévu) : noté dans TODO.

## 021 — Emploi du temps : le professeur suit l'affectation

Un créneau se crée par classe et matière ; le professeur est celui affecté à cette matière dans la classe. On évite ainsi les incohérences entre emploi du temps et affectations, et les conflits professeur sont détectés automatiquement.

## 022 — Bulletins PDF générés côté serveur avec @react-pdf/renderer

Pas de navigateur sans tête à installer (léger sur un VPS) ; gabarit en composants React, polices standard (accents français couverts). Les PDF sont stockés : un bulletin publié ne change plus, même si les données évoluent ; une réédition crée un nouveau document (l'ancien est archivé).

## 023 — Validation des notes par classe et par période

La direction valide d'un geste toutes les évaluations d'une classe pour une période. C'est ce verrou qui autorise l'édition des bulletins ; il protège les notes contre les modifications tardives (tracées si la direction déverrouille).

## 024 — Moyennes recalculées à la demande

Les moyennes et rangs ne sont pas stockés pendant la saisie (pas de désynchronisation possible) : ils sont recalculés à l'affichage, puis figés dans `ReportCard` à l'édition du bulletin.

## 025 — Appréciation générale : `subjectId` vide

Une seule table `Appraisal` ; la valeur « » (chaîne vide) désigne l'appréciation générale, ce qui permet une contrainte d'unicité simple (les NULL ne sont pas uniques en PostgreSQL).
