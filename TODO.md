# À faire

## Phases

- [x] **Phase 1 : Fondations** — schéma complet, seed, authentification, multi-tenant, RBAC, navigation par rôle, i18n
- [x] **Phase 2 : Structure et acteurs** — années, périodes, classes, matières ; élèves, parents (comptes automatiques + accès WhatsApp), personnel, affectations ; import Excel/CSV ; pré-inscription en ligne ; paramètres ; journal d'audit
- [x] **Phase 3 : Pédagogie quotidienne** — emploi du temps (conflits, annulations, remplacements), cahier de textes, devoirs (rendu, correction, rappels), appel hors ligne avec notification parent, justificatifs, discipline, file de tâches BullMQ
- [x] **Phase 4 : Évaluations** — saisie des notes, moyennes et rangs, verrouillage, conseil de classe, bulletins PDF
- [x] **Phase 5 : Finances** — grilles de frais, échéanciers, réductions, paiements à l'école, reçus PDF, annulation, relances, dépenses, caisse et clôture, paie, tableaux de bord, espace parent
- [x] **Phase 6 : Communication** — messagerie (texte et vocal, modération), annonces et circulaires avec accusé de lecture, notifications in-app/WhatsApp/email avec heures calmes, suivi des envois (webhook), temps réel (SSE), rendez-vous parents-professeurs
- [x] **Phase 7 : SaaS** — espace super admin, formules et conditions particulières, modules activables, limites (élèves, WhatsApp), cycle d'abonnement (essai, renouvellement, impayé, lecture seule), factures LAKOL en PDF, inscription en ligne, assistant de démarrage (modèle malien), sous-domaines
- [ ] **Phase 8 : Finitions** — PWA et hors ligne, tableaux de bord avancés, modules optionnels, performances

## Améliorations prévues

- [ ] Paiement en ligne des factures LAKOL (mobile money) et relances automatiques par WhatsApp avant échéance.
- [ ] Rôles et modules de la cantine, du transport, de la bibliothèque et de l'infirmerie (modules prévus, interfaces en phase 8).
- [ ] Domaine personnalisé par école (URL sans chemin) et cookies par domaine.
- [ ] Facturation au prorata en cours d'année (aujourd'hui : facture annuelle, effectif saisi à la main si besoin).
- [ ] Export comptable des factures de la plateforme et statistiques de revenus par mois.
- [ ] Ajout d'une deuxième école à un compte existant depuis l'inscription en ligne (aujourd'hui : par le super admin).

- [ ] Modèles de messages WhatsApp approuvés par Meta (obligatoires hors fenêtre de 24 h) : aujourd'hui, envoi de texte libre.
- [ ] Conversations de groupe (ex. professeur ↔ deux parents d'un même élève) et pièces jointes autres qu'audio dans la messagerie.
- [ ] Annonces programmées (date de publication future) et brouillons.
- [ ] Notifications push du navigateur (Web Push) avec la PWA (phase 8).
- [ ] SSE via Redis pub/sub au lieu de l'interrogation de la base toutes les 5 s, si la charge l'exige.
- [ ] Rendez-vous : export calendrier (.ics) et rappel la veille.
- [ ] Horaires de messagerie côté professeur (ne pas recevoir de WhatsApp le soir) en plus des heures calmes de l'école.

- [ ] Exports Excel (journal des paiements, impayés, dépenses) — phase 8.
- [ ] Rapprochement bancaire (relevés de virements et de chèques encaissés).
- [ ] Avoirs et remboursements (aujourd'hui : un trop-perçu est refusé).
- [ ] Recalcul des factures déjà émises quand une réduction est ajoutée en cours d'année (aujourd'hui : échéances futures uniquement).

- [ ] Bulletin annuel (moyenne annuelle, décision de fin d'année) et bilan des trois périodes.
- [ ] Impression groupée des bulletins d'une classe (un seul PDF) et des cartes scolaires.
- [ ] Graphique de progression de l'enfant d'une période à l'autre (espace parent, phase 8).
- [ ] Page publique de vérification d'un bulletin ou d'une carte via le QR code.

- [ ] Fuseau horaire par école (`School.timezone`) pour les pays hors UTC.
- [ ] Messages vocaux du professeur sur un devoir (pièce jointe audio).
- [ ] Statistiques d'assiduité par période (trimestre) et par classe, avec export.
- [ ] Regroupement quotidien des notifications WhatsApp par parent (limiter le volume).

- [ ] Compression des photos et logos à l'envoi (aujourd'hui : 5 Mo max, formats contrôlés).
- [ ] Notifier le parent par WhatsApp quand sa pré-inscription est refusée.
- [ ] Réinscription en masse d'une classe vers l'année suivante (aujourd'hui : élève par élève).
- [ ] Grille de coefficients pour une nouvelle série de lycée depuis l'interface (aujourd'hui : séries existantes du seed ou via le niveau sans série).

- [ ] **Paiement mobile** (Orange Money, Moov Money, Wave) : implémenter un `PaymentProvider`. Le modèle `Payment` a déjà `provider` / `providerRef`, et `PaymentMethod.MOBILE_MONEY` est réservé.
- [ ] Row-Level Security PostgreSQL en défense supplémentaire de l'extension `forSchool()`.
- [ ] Connexion par code WhatsApp sans mot de passe (`VerificationPurpose.LOGIN` déjà prévu).
- [ ] Langue bambara (`src/messages/bm.json`).
- [ ] Filtrage automatique des lignes `deletedAt` dans l'extension Prisma (aujourd'hui explicite dans les requêtes).
- [ ] Limitation des tentatives via Redis plutôt qu'en base, quand Redis sera en place.
- [ ] Rôles personnalisés par école (interface d'édition des permissions).
