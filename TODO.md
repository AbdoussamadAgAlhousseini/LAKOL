# À faire

## Phases

- [x] **Phase 1 : Fondations** — schéma complet, seed, authentification, multi-tenant, RBAC, navigation par rôle, i18n
- [x] **Phase 2 : Structure et acteurs** — années, périodes, classes, matières ; élèves, parents (comptes automatiques + accès WhatsApp), personnel, affectations ; import Excel/CSV ; pré-inscription en ligne ; paramètres ; journal d'audit
- [x] **Phase 3 : Pédagogie quotidienne** — emploi du temps (conflits, annulations, remplacements), cahier de textes, devoirs (rendu, correction, rappels), appel hors ligne avec notification parent, justificatifs, discipline, file de tâches BullMQ
- [ ] **Phase 4 : Évaluations** — saisie des notes, moyennes et rangs, verrouillage, conseil de classe, bulletins PDF
- [ ] **Phase 5 : Finances** — frais, échéanciers, réductions, paiements à l'école, reçus PDF, relances, dépenses
- [ ] **Phase 6 : Communication** — messagerie, annonces, notifications multicanal, accusés de lecture, rendez-vous
- [ ] **Phase 7 : SaaS** — super admin complet, abonnements, modules activables, onboarding, sous-domaines
- [ ] **Phase 8 : Finitions** — PWA et hors ligne, tableaux de bord avancés, modules optionnels, performances

## Améliorations prévues

- [ ] Fuseau horaire par école (`School.timezone`) pour les pays hors UTC.
- [ ] Messages vocaux du professeur sur un devoir (pièce jointe audio).
- [ ] Statistiques d'assiduité par période (trimestre) et par classe, avec export.
- [ ] Regroupement quotidien des notifications WhatsApp par parent (limiter le volume).
- [ ] Interface de consultation des notifications in-app (phase 6).

- [ ] Carte scolaire PDF avec QR code (avec la génération PDF de la phase 4).
- [ ] Compression des photos et logos à l'envoi (aujourd'hui : 5 Mo max, formats contrôlés).
- [ ] Notifier le parent par WhatsApp quand sa pré-inscription est refusée.
- [ ] Réinscription en masse d'une classe vers l'année suivante (aujourd'hui : élève par élève).
- [ ] Grille de coefficients pour une nouvelle série de lycée depuis l'interface (aujourd'hui : séries existantes du seed ou via le niveau sans série).

- [ ] **Paiement mobile** (Orange Money, Moov Money, Wave) : implémenter un `PaymentProvider`. Le modèle `Payment` a déjà `provider` / `providerRef`, et `PaymentMethod.MOBILE_MONEY` est réservé.
- [ ] Row-Level Security PostgreSQL en défense supplémentaire de l'extension `forSchool()`.
- [ ] Connexion par code WhatsApp sans mot de passe (`VerificationPurpose.LOGIN` déjà prévu).
- [ ] Sous-domaines `ecole-x.domaine` réécrits vers `/{langue}/ecole-x` dans le middleware.
- [ ] Langue bambara (`src/messages/bm.json`) et messages vocaux (`Message.audioUrl` prévu).
- [ ] Filtrage automatique des lignes `deletedAt` dans l'extension Prisma (aujourd'hui explicite dans les requêtes).
- [ ] Limitation des tentatives via Redis plutôt qu'en base, quand Redis sera en place.
- [ ] Rôles personnalisés par école (interface d'édition des permissions).
