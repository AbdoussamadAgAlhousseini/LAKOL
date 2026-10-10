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

## 026 — Paiements uniquement à l'école, mobile money prévu

Conformément au cahier des charges, aucun paiement en ligne : le caissier enregistre chaque paiement. Le modèle (`Payment.provider`, `providerRef`, méthode `MOBILE_MONEY`) et l'interface `PaymentProvider` permettront d'ajouter Orange Money, Moov Money ou Wave sans refonte.

## 027 — Factures par échéance et répartition automatique

Une facture par échéance (plutôt qu'une facture annuelle) donne un suivi clair des retards et des relances ciblées. Un paiement est réparti automatiquement sur les échéances les plus anciennes (ou sur celle choisie), ce qui correspond à la pratique des caisses d'école.

## 028 — Reçus générés à la demande

Le reçu PDF est reconstruit à partir des données à chaque téléchargement (numéro, montant et répartition sont figés en base) : pas de fichier à stocker, et la mention « ANNULÉ » apparaît automatiquement après une annulation.

## 029 — Relances limitées et ciblées

Au plus une relance WhatsApp par semaine et par élève, uniquement aux tuteurs autorisés à voir les frais : on limite le coût des messages et on respecte les familles (ex. parent séparé sans accès aux frais).

## 030 — Server-Sent Events plutôt que WebSockets

Les besoins temps réel (compteurs, nouveaux messages) vont du serveur vers le client : SSE suffit, passe par HTTP standard (proxys, Vercel, VPS), se reconnecte seul et ne demande pas de serveur dédié. Le flux interroge la base toutes les 5 s et se ferme après 5 min ; un passage à Redis pub/sub est possible si la charge l'exige.

## 031 — Pas de messagerie entre parents, conversations à deux

Pour protéger les familles et les données des mineurs, un parent ne peut écrire qu'aux professeurs de ses enfants et à l'administration. Les conversations sont à deux personnes et rattachées à l'élève concerné ; une nouvelle prise de contact reprend la conversation existante.

## 032 — Un seul WhatsApp tant que le message précédent n'est pas lu

Un nouveau message déclenche un WhatsApp seulement si le destinataire n'a pas de notification non lue pour cette conversation : on évite d'inonder un parent pendant un échange, tout en le prévenant du premier message.

## 033 — Heures calmes côté école

Les envois WhatsApp/email non urgents sont différés hors de la plage 20 h – 7 h (réglable par l'école). Le délai est calculé dans le fuseau de l'école et confié à BullMQ ; une tâche périodique rattrape les envois restés en attente (redémarrage, Redis indisponible). Les messages urgents (absence, cours annulé, accès au compte) partent immédiatement.

## 034 — Le droit de lire une annonce découle de sa notification

À la publication, chaque destinataire reçoit une notification liée à l'annonce. C'est cette notification qui donne accès à l'annonce et à l'accusé de lecture : le public est figé au moment de l'envoi (un élève arrivé plus tard ne reçoit pas une ancienne circulaire), et les statistiques de lecture sont exactes.

## 035 — Rendez-vous par créneaux publiés

Plutôt qu'un agenda partagé, le professeur publie des séries de créneaux et le parent en réserve un. La réservation est une mise à jour conditionnelle (`status = OPEN`) : deux parents ne peuvent pas obtenir le même créneau.

## 036 — Modules coupés par les permissions

Désactiver un module retire ses permissions du périmètre de l'utilisateur au chargement du contexte. Navigation, pages, actions et services s'appuient déjà sur les permissions : un seul point de contrôle, impossible d'oublier une route. Les données du module sont conservées et réapparaissent à la réactivation.

## 037 — Fin d'essai : formule gratuite plutôt que suspension

Une école qui ne paie pas à la fin de l'essai garde l'accès à ses données et aux modules de la formule gratuite. On ne bloque pas une école au milieu d'un trimestre pour une décision commerciale ; seule une formule payante non réglée mène à la lecture seule, après 15 jours de grâce.

## 038 — Facturation annuelle au nombre d'élèves, paiement enregistré à la main

Comme pour les familles, les écoles paient par virement, chèque ou mobile money hors ligne : le super admin enregistre le règlement. La facture annuelle (élèves inscrits × prix) correspond au fonctionnement budgétaire des écoles ; un paiement en ligne pourra se brancher plus tard sur le même modèle.

## 039 — Quota WhatsApp : bascule vers l'email, jamais de blocage

Quand le quota mensuel est atteint, les messages partent par email (ou restent dans l'application) au lieu d'être refusés ; les messages urgents (absence, accès au compte, suspension) passent toujours. Les parents ne perdent pas d'information importante à cause d'une limite commerciale.

## 040 — Inscription en ligne des écoles

Une école peut créer son espace seule (essai de 30 jours, formule Standard) : c'est le moyen le plus simple d'acquérir des écoles. Limité à 3 créations par adresse IP et par jour ; un numéro déjà utilisé est refusé (l'ajout d'une école à un compte existant passe par la plateforme).

## 041 — Sous-domaines par redirection

Le sous-domaine `ecole-x.domaine` redirige vers l'espace de l'école, dont les URL gardent le chemin de l'école. Toutes les URL existantes restent valables, sans réécriture complexe ni cookies par domaine ; un vrai domaine par école (URL sans chemin) reste possible plus tard.

## 042 — Service worker écrit à la main

Un service worker de quelques dizaines de lignes (pas de bibliothèque type Workbox) : les règles sont simples (réseau d'abord pour les pages utiles, cache d'abord pour les fichiers versionnés) et faciles à relire. Le cache des pages est vidé au retour sur la connexion, pour qu'un téléphone partagé ne montre pas les données d'un autre compte.

## 043 — Graphiques en SVG rendus côté serveur

Les graphiques (progression, assiduité, moyennes par classe) sont dessinés en SVG par des composants serveur : aucun JavaScript supplémentaire sur des téléphones d'entrée de gamme. Une seule série par graphique, couleur de l'école, repère de la moyenne ; quand une seule valeur existe, un chiffre remplace la courbe.

## 044 — Modules optionnels en version simple

Cantine, transport, bibliothèque, infirmerie et stocks couvrent l'usage courant (listes, mouvements, vue famille) sans fonctions avancées (paiement de la cantine par repas, suivi GPS, réservations de livres). Les paiements de cantine et de transport passent par les frais de l'école (phase 5), sans double saisie.

## 045 — Exports Excel côté serveur

Les exports réutilisent les services des pages (mêmes droits, mêmes calculs) et produisent un vrai classeur (en-têtes figés, filtres, formats monétaires et dates), directement exploitable par la direction ou le comptable.

## 046 — Compression des images à l'envoi

Les photos prises au téléphone pèsent souvent plusieurs mégaoctets. Elles sont converties en WebP (1600 px au plus) avant stockage : moins de stockage, et des pages qui s'affichent vite en 3G. Les PDF et les fichiers audio ne sont pas modifiés.

## 047 — Un serveur, Docker Compose et Caddy

Pour les premières écoles, un VPS avec Docker Compose est le plus simple à exploiter et le moins cher : tout tient dans un fichier, sans dépendre d'un fournisseur. Caddy apporte le HTTPS automatique, y compris pour chaque sous-domaine d'école (certificat obtenu à la première visite, seulement si `/api/tls-check` confirme que l'école existe). La même image tourne ailleurs (Railway, Kubernetes) si la charge l'exige.

## 048 — WhatsApp : toujours le modèle approuvé

Meta n'autorise le texte libre que dans les 24 h qui suivent un message du destinataire ; or LAKOL écrit presque toujours en premier (absence, facture, accès). Toutes les notifications passent donc par un seul modèle « utilitaire » à trois variables (titre, message, lien), approuvé une fois pour toutes, dans la langue du destinataire.

## 049 — Configuration vérifiée au démarrage

En production (`DEPLOY_ENV=production`), l'application et le worker refusent de démarrer si une variable indispensable manque (HTTPS, Redis, secrets WhatsApp, modèle, Resend, S3). Une erreur de configuration se voit au déploiement, pas des semaines plus tard quand un parent ne reçoit pas un message. Hors production, les mêmes contrôles ne font qu'avertir.

## 050 — Migrations et initialisation dans un service dédié

Le service `migrate` applique les migrations puis `platform:init` (permissions, formules, super admin) avant que l'application ne démarre ; l'image de l'application n'embarque ni la CLI Prisma ni de téléchargement au démarrage. `platform:init` est idempotent et ne crée jamais de données de démonstration.

## 051 — Aperçu en ligne sur Vercel, sans Redis

Pour montrer LAKOL avant d'avoir un serveur, l'application se déploie telle quelle sur Vercel (offre gratuite) avec une base Neon. Sans Redis, les tâches s'exécutent dans la requête (décision existante pour le développement) : les envois immédiats fonctionnent, mais pas les rappels programmés ni les envois différés. Les fichiers déposés vont dans `/tmp` et sont temporaires. Les données de démonstration sont chargées par une action GitHub lancée à la main (`Base de démonstration`) avec une confirmation explicite, pour ne jamais effacer une base par erreur. La production reste sur le VPS (décision 047).
