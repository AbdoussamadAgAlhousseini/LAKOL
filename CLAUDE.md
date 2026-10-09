# LAKOL : cahier des charges

> Référence du projet. L'architecture retenue est décrite dans `ARCHITECTURE.md`,
> les choix dans `DECISIONS.md` et le reste à faire dans `TODO.md`.

---

## 1. Rôle et mission

Tu es un ingénieur logiciel senior full-stack et architecte SaaS. Tu vas concevoir et développer **LAKOL**, une plateforme SaaS de gestion scolaire complète, multi-écoles (multi-tenant), pensée d'abord pour les écoles d'Afrique de l'Ouest francophone (Mali en priorité), mais configurable pour d'autres pays.

La plateforme relie dans un seul outil : la direction, l'administration, les professeurs, les parents et les élèves. Chaque acteur a son propre compte et son propre espace.

Avant d'écrire du code :

1. Lis entièrement ce document.
2. Propose-moi un plan d'architecture (arborescence, schéma de base de données, choix techniques) et attends ma validation.
3. Ensuite, développe phase par phase (voir section 10). À la fin de chaque phase : le code compile, les tests passent, et tu me fais un résumé de ce qui a été fait et de ce qui reste.

Pose-moi des questions uniquement si une décision est vraiment bloquante. Sinon, prends le choix le plus raisonnable et note-le dans `DECISIONS.md`.

---

## 2. Contexte d'usage (contraintes réelles)

- Connexion internet souvent lente ou instable : l'application doit être légère, rapide, et fonctionner en **PWA** (installable sur téléphone, cache hors ligne pour la consultation).
- La majorité des parents utilisent un **smartphone Android d'entrée de gamme** : interface mobile-first, gros boutons, peu de texte.
- Certains parents lisent peu ou pas le français : prévoir des icônes claires, des codes couleur, et une architecture **i18n** dès le départ (français par défaut, anglais, et possibilité d'ajouter bambara ou d'autres langues plus tard). Prévoir aussi la possibilité de messages vocaux.
- Les notifications passent par trois canaux uniquement : notification in-app, **WhatsApp** (via l'API WhatsApp Business) et **email**. Pas de SMS. WhatsApp est le canal principal pour les parents.
- **Paiements** : dans cette version, les parents paient **directement à l'école** (espèces, chèque ou virement). L'application sert à enregistrer ces paiements, suivre les soldes et éditer les reçus. **Aucun paiement en ligne** pour l'instant : le mobile money (Orange Money, Moov Money, Wave) est prévu pour une mise à jour future. Monnaie par défaut : **FCFA (XOF)**, configurable.
- Système scolaire configurable : cycles (maternelle, fondamental 1er cycle, fondamental 2e cycle, lycée), classes, séries (lycée), découpage en **trimestres** ou semestres, notation sur 10 ou sur 20, coefficients par matière, examens nationaux (DEF, BAC) à suivre.

---

## 3. Stack technique recommandée

Utilise cette stack sauf raison forte de faire autrement (à justifier dans `DECISIONS.md`) :

- **Frontend + Backend** : Next.js (App Router) + TypeScript strict
- **UI** : Tailwind CSS + shadcn/ui, design mobile-first, mode clair/sombre
- **Base de données** : PostgreSQL
- **ORM** : Prisma
- **Authentification** : Auth.js (NextAuth) ou Lucia, connexion par email OU numéro de téléphone + mot de passe, code de vérification par WhatsApp ou email en option, réinitialisation du mot de passe
- **Validation** : Zod (côté client et serveur)
- **Fichiers** (devoirs, photos, documents) : stockage compatible S3 (ex. Cloudflare R2, Supabase Storage)
- **Tâches de fond** (envois WhatsApp et email, bulletins PDF, rappels) : file de tâches (ex. BullMQ + Redis, ou Inngest)
- **PDF** (bulletins, reçus, cartes scolaires) : génération côté serveur
- **Temps réel** (messagerie, notifications) : WebSockets ou Server-Sent Events
- **Tests** : Vitest (unitaires), Playwright (parcours complets)
- **Déploiement** : Docker + docker-compose pour le local, prêt pour Vercel/Railway/VPS

Prévois des interfaces (adapters) pour les services externes (WhatsApp, email) afin de pouvoir changer de fournisseur sans toucher au reste du code. Structure aussi le module finances de façon à pouvoir brancher plus tard un adapter de paiement mobile sans refonte. En développement, utilise des versions simulées (mock) qui écrivent dans les logs.

---

## 4. Architecture multi-tenant

- Chaque école est un **tenant** (`School`). Toutes les tables métier portent un `schoolId`.
- Isolation stricte : aucune requête ne doit pouvoir lire ou modifier les données d'une autre école. Centralise ce filtrage (middleware ou couche d'accès aux données), ne le laisse pas à la discrétion de chaque route.
- Une école peut avoir plusieurs **sites/annexes**.
- Chaque école choisit un **abonnement** (formules, voir section 8).
- Chaque école peut personnaliser : logo, couleurs, nom, en-tête des bulletins, année scolaire, barèmes, frais.
- Accès par sous-domaine (`ecole-x.[domaine]`) ou par sélection d'école à la connexion.
- Un même utilisateur peut avoir plusieurs rôles (ex. un professeur qui est aussi parent d'élève) et basculer entre ses espaces.
- Un parent peut avoir plusieurs enfants, éventuellement dans des écoles différentes utilisant la plateforme.

---

## 5. Rôles et permissions (RBAC)

Implémente un système de rôles avec permissions fines (pas seulement des `if role === ...` dispersés).

| Rôle                                                  | Périmètre                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Super Admin plateforme**                            | Gère toutes les écoles, abonnements, facturation SaaS, statistiques globales, support |
| **Directeur / Promoteur**                             | Tout dans son école, tableaux de bord, validation des bulletins, finances             |
| **Administrateur / Secrétariat**                      | Inscriptions, dossiers élèves, emplois du temps, communication                        |
| **Censeur / Surveillant général**                     | Discipline, absences, retards, vie scolaire                                           |
| **Comptable / Caissier**                              | Frais, paiements, reçus, relances, dépenses, salaires                                 |
| **Professeur**                                        | Ses classes et matières uniquement : cours, devoirs, notes, présences, messages       |
| **Professeur principal**                              | En plus : vue globale de sa classe, appréciations générales, conseil de classe        |
| **Parent / Tuteur**                                   | Uniquement ses propres enfants : notes, devoirs, absences, paiements, messages        |
| **Élève**                                             | Son propre espace : devoirs, cours, notes, emploi du temps, ressources                |
| **Bibliothécaire, Infirmier, Chauffeur** (optionnels) | Modules correspondants seulement                                                      |

Règles importantes :

- Un professeur ne voit que les élèves des classes où il enseigne.
- Un parent ne voit jamais les données d'un autre élève.
- Les comptes élèves des plus jeunes (maternelle, début du fondamental) peuvent être désactivés : seul le parent a accès.
- Toute action sensible (modification de note après validation, suppression de paiement, changement de rôle) est tracée dans un **journal d'audit** (qui, quoi, quand, ancienne valeur, nouvelle valeur).

---

## 6. Modules fonctionnels

### 6.1 Structure de l'école

- Années scolaires (une seule active, archivage des précédentes)
- Périodes : trimestres ou semestres, avec dates
- Cycles, niveaux, classes, séries, salles
- Matières, coefficients par niveau/série, volume horaire
- Calendrier : jours fériés, vacances, examens, événements

### 6.2 Gestion des élèves

- Pré-inscription en ligne par les parents, puis validation par l'école
- Inscription, réinscription, transfert, abandon, exclusion
- Fiche élève complète : identité, photo, date et lieu de naissance, matricule auto-généré, tuteurs liés, contacts d'urgence, informations médicales utiles (allergies, groupe sanguin), documents scannés (acte de naissance, certificats)
- Historique scolaire sur plusieurs années
- Carte scolaire en PDF avec QR code
- Import en masse depuis Excel/CSV

### 6.3 Gestion des professeurs et du personnel

- Fiche personnel : identité, diplômes, contrat (permanent, vacataire), matières enseignées
- Affectation aux classes et matières
- Disponibilités pour l'emploi du temps
- Présence du personnel
- Gestion des salaires et des heures de vacation (lien avec la comptabilité)
- Congés et absences du personnel, remplacements

### 6.4 Gestion des parents

- Compte parent créé automatiquement à l'inscription de l'enfant (identifiant = numéro de téléphone), envoi des accès par WhatsApp (ou par email si le parent en a un)
- Un parent, plusieurs enfants ; un enfant, plusieurs tuteurs (père, mère, tuteur légal) avec droits configurables
- Tableau de bord parent : vue rapide par enfant (dernières notes, devoirs à rendre, absences, solde des frais, messages non lus)

### 6.5 Emploi du temps

- Création par classe et par professeur, détection automatique des conflits (prof ou salle déjà occupés)
- Vue semaine pour élèves, parents et professeurs
- Remplacements et annulations de cours notifiés aux parents

### 6.6 Cahier de textes et devoirs (module central)

- Le professeur publie : contenu de la séance, devoir à faire, date limite, pièces jointes (PDF, images, audio), lien
- L'élève voit ses devoirs, peut marquer "fait" et, si activé, **déposer son travail** en ligne
- Le parent voit les mêmes devoirs que son enfant et peut suivre s'ils sont faits
- Le professeur voit qui a rendu, corrige, note et commente
- Rappels automatiques avant la date limite (élève et parent)
- Vue calendrier des devoirs pour éviter qu'une classe soit surchargée le même jour

### 6.7 Présences et vie scolaire

- Appel en début de cours par le professeur, en quelques clics depuis le téléphone (mode hors ligne puis synchronisation)
- Absences, retards, motifs, justificatifs déposés par le parent
- **Notification immédiate au parent** (WhatsApp et in-app) en cas d'absence
- Discipline : incidents, avertissements, sanctions, convocations
- Statistiques d'assiduité par élève, classe, période

### 6.8 Notes, évaluations et bulletins

- Types d'évaluation : interrogation, devoir, composition, examen blanc, avec pondération configurable
- Saisie des notes par le professeur (grille rapide par classe), import Excel possible
- Calcul automatique : moyennes par matière, moyenne générale pondérée, rang, moyenne de classe, plus forte et plus faible moyenne
- Appréciations par matière et appréciation générale du professeur principal
- Verrouillage des notes après validation par la direction
- Conseil de classe : décisions (passage, redoublement, exclusion), distinctions (tableau d'honneur, félicitations, encouragements)
- **Bulletins PDF** aux couleurs de l'école, publication en un clic vers les parents
- Possibilité de bloquer l'accès au bulletin si les frais ne sont pas réglés (option réglable par l'école)
- Suivi de la préparation aux examens nationaux (DEF, BAC) : examens blancs, statistiques

### 6.9 Finances et frais scolaires

- Grille de frais par niveau : inscription, scolarité (mensuelle, trimestrielle ou annuelle), cantine, transport, tenue, fournitures, activités
- Réductions : fratrie, bourse, enfant du personnel, remise exceptionnelle
- Échéancier par élève, solde en temps réel
- Les paiements se font **à l'école uniquement** : le caissier enregistre chaque paiement (espèces, chèque, virement) avec date, montant, mode et référence
- Pas de paiement en ligne dans cette version (mobile money prévu en mise à jour future, noter dans `TODO.md`)
- Le parent voit dans son espace le détail des frais, ce qui a été payé et ce qui reste dû
- **Reçus PDF** numérotés automatiquement, consultables par le parent
- Relances automatiques des impayés par WhatsApp et email
- Dépenses de l'école, caisse journalière, rapprochement
- Tableaux de bord : recettes attendues vs encaissées, taux de recouvrement, impayés par classe

### 6.10 Communication

- Messagerie interne : parent ↔ professeur, parent ↔ administration, avec règles (horaires, modération)
- Annonces : à toute l'école, un niveau, une classe, un groupe ciblé
- Envois groupés par WhatsApp et email, avec suivi des envois (envoyé, remis, lu quand l'API le permet)
- Réunions parents-professeurs : prise de rendez-vous en ligne
- Circulaires avec accusé de lecture

### 6.11 Ressources pédagogiques

- Bibliothèque numérique par matière et niveau (cours, exercices, corrigés, sujets d'examens passés)
- Quiz simples en ligne avec correction automatique (phase ultérieure)

### 6.12 Modules optionnels (activables par école)

- Cantine (inscrits, menus, paiements)
- Transport scolaire (circuits, arrêts, élèves par bus)
- Bibliothèque physique (prêts, retours)
- Infirmerie (passages, suivi)
- Stocks et inventaire

### 6.13 Tableaux de bord et rapports

- Direction : effectifs, taux de présence, résultats par classe et matière, finances, alertes (élèves en difficulté, impayés)
- Professeur : ses classes, devoirs à corriger, moyennes
- Parent : progression de l'enfant dans le temps (graphiques simples)
- Export Excel et PDF de toutes les listes et statistiques

---

## 7. Modèle de données (entités principales)

Conçois le schéma Prisma en couvrant au minimum :

`School`, `Campus`, `Subscription`, `User`, `Role`, `Permission`, `UserRole`, `AcademicYear`, `Term`, `Cycle`, `Level`, `Track` (série), `Class`, `Room`, `Subject`, `SubjectCoefficient`, `Student`, `Guardian`, `StudentGuardian`, `Enrollment`, `Staff`, `TeachingAssignment`, `TimetableSlot`, `Lesson` (cahier de textes), `Homework`, `HomeworkSubmission`, `Attendance`, `DisciplineIncident`, `Assessment`, `Grade`, `ReportCard`, `ClassCouncilDecision`, `FeeType`, `FeeSchedule`, `Discount`, `Invoice`, `Payment`, `Receipt`, `Expense`, `Payroll`, `Message`, `Conversation`, `Announcement`, `Notification`, `Document`, `Resource`, `Event`, `AuditLog`.

Règles :

- Clés primaires en `cuid` ou `uuid`
- `createdAt`, `updatedAt` partout, suppression logique (`deletedAt`) pour les données sensibles
- Index sur `schoolId` et sur les champs de recherche fréquents
- Montants en entiers (pas de flottants pour l'argent)
- Fournis un **script de seed** réaliste : une école de démonstration avec classes, 30 élèves, profs, parents, notes, devoirs, paiements

---

## 8. Modèle SaaS et abonnements

- Formules d'exemple : **Gratuit/Essai** (limité en nombre d'élèves et de modules), **Standard**, **Premium** (tous modules, quota WhatsApp élevé, support prioritaire)
- Tarification par nombre d'élèves, configurable par le super admin
- Activation/désactivation des modules selon la formule
- Période d'essai, renouvellement, suspension en cas de non-paiement (lecture seule, jamais de perte de données)
- Onboarding guidé d'une nouvelle école : assistant en étapes (infos école, année scolaire, classes, matières, import des élèves, invitation des profs)

---

## 9. Exigences transverses

- **Sécurité** : mots de passe hachés (argon2 ou bcrypt), protection CSRF, limitation des tentatives de connexion, validation de toutes les entrées, contrôle d'accès vérifié côté serveur à chaque requête, données médicales et financières protégées
- **Confidentialité** : données des mineurs traitées avec prudence, consentement des parents, export et suppression des données sur demande
- **Performance** : pagination partout, pages légères, images compressées, chargement rapide sur 3G
- **Hors ligne** : appel des présences et consultation des devoirs disponibles sans connexion, synchronisation au retour du réseau
- **Accessibilité** : contrastes suffisants, tailles de texte lisibles, navigation clavier
- **Sauvegardes** : stratégie de sauvegarde documentée
- **Qualité du code** : TypeScript strict, ESLint + Prettier, composants réutilisables, logique métier séparée de l'interface, pas de duplication, commentaires seulement là où c'est utile
- **Documentation** : `README.md` (installation, lancement, variables d'environnement), `ARCHITECTURE.md`, `DECISIONS.md`, `.env.example`

---

## 10. Plan de développement par phases

Avance dans cet ordre. Ne passe pas à la phase suivante sans que la précédente soit fonctionnelle et testée.

**Phase 1 : Fondations**
Initialisation du projet, Docker, base de données, schéma Prisma complet, seed, authentification (email ou téléphone), multi-tenant, RBAC, layout de base avec navigation par rôle, i18n.

**Phase 2 : Structure et acteurs**
Écoles, années scolaires, périodes, classes, matières. CRUD élèves, parents (création auto + liaison), personnel, affectations professeurs. Import Excel.

**Phase 3 : Pédagogie quotidienne**
Emploi du temps, cahier de textes, devoirs (publication, consultation parent/élève, rendu, correction), présences avec notification parent.

**Phase 4 : Évaluations**
Notes, calcul des moyennes et rangs, appréciations, verrouillage, conseil de classe, bulletins PDF, publication aux parents.

**Phase 5 : Finances**
Frais, échéanciers, réductions, enregistrement des paiements faits à l'école, reçus PDF, relances, dépenses, tableaux de bord financiers.

**Phase 6 : Communication**
Messagerie, annonces, notifications multicanal (in-app, WhatsApp, email) via file de tâches, accusés de lecture, rendez-vous.

**Phase 7 : SaaS**
Espace super admin, abonnements, modules activables, onboarding guidé, facturation des écoles.

**Phase 8 : Finitions**
PWA et hors ligne, tableaux de bord avancés, modules optionnels, tests Playwright des parcours clés, optimisation des performances, documentation finale.

---

## 11. Parcours à tester en priorité (Playwright)

1. Un parent se connecte avec son numéro, voit ses deux enfants, consulte un devoir et la dernière note.
2. Un professeur fait l'appel depuis un écran mobile ; le parent de l'élève absent reçoit une notification.
3. Un professeur publie un devoir avec pièce jointe ; l'élève le voit et dépose son travail.
4. Le professeur saisit les notes, la direction valide, le bulletin PDF est publié et visible par le parent.
5. Le caissier enregistre un paiement en espèces ; le reçu PDF est généré et le solde du parent se met à jour.
6. Un professeur tente d'accéder à une classe qui n'est pas la sienne : accès refusé.
7. Un utilisateur de l'école A tente d'accéder à une donnée de l'école B : accès refusé.

---

## 12. Façon de travailler

- Commence par me présenter le plan d'architecture et le schéma de données, puis attends mon accord.
- Fais des commits Git clairs et fréquents, un par fonctionnalité cohérente.
- À la fin de chaque phase, donne-moi : ce qui fonctionne, comment le tester, les limites connues, la suite.
- Si une fonctionnalité est trop lourde pour l'instant, crée une version simple qui marche plutôt qu'une version complète inachevée, et note l'amélioration prévue dans `TODO.md`.
