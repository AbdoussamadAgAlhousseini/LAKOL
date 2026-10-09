# À faire

## Phases

- [x] **Phase 1 : Fondations** — schéma complet, seed, authentification, multi-tenant, RBAC, navigation par rôle, i18n
- [ ] **Phase 2 : Structure et acteurs** — années, périodes, classes, matières ; CRUD élèves, parents (création auto + envoi des accès WhatsApp), personnel, affectations ; import Excel ; paramètres et personnalisation de l'école ; journal d'audit consultable
- [ ] **Phase 3 : Pédagogie quotidienne** — emploi du temps (détection de conflits), cahier de textes, devoirs (rendu, correction), appel avec notification parent (BullMQ)
- [ ] **Phase 4 : Évaluations** — saisie des notes, moyennes et rangs, verrouillage, conseil de classe, bulletins PDF
- [ ] **Phase 5 : Finances** — frais, échéanciers, réductions, paiements à l'école, reçus PDF, relances, dépenses
- [ ] **Phase 6 : Communication** — messagerie, annonces, notifications multicanal, accusés de lecture, rendez-vous
- [ ] **Phase 7 : SaaS** — super admin complet, abonnements, modules activables, onboarding, sous-domaines
- [ ] **Phase 8 : Finitions** — PWA et hors ligne, tableaux de bord avancés, modules optionnels, performances

## Améliorations prévues

- [ ] **Paiement mobile** (Orange Money, Moov Money, Wave) : implémenter un `PaymentProvider`. Le modèle `Payment` a déjà `provider` / `providerRef`, et `PaymentMethod.MOBILE_MONEY` est réservé.
- [ ] Row-Level Security PostgreSQL en défense supplémentaire de l'extension `forSchool()`.
- [ ] Connexion par code WhatsApp sans mot de passe (`VerificationPurpose.LOGIN` déjà prévu).
- [ ] Sous-domaines `ecole-x.domaine` réécrits vers `/{langue}/ecole-x` dans le middleware.
- [ ] Langue bambara (`src/messages/bm.json`) et messages vocaux (`Message.audioUrl` prévu).
- [ ] Filtrage automatique des lignes `deletedAt` dans l'extension Prisma (aujourd'hui explicite dans les requêtes).
- [ ] Limitation des tentatives via Redis plutôt qu'en base, quand Redis sera en place.
- [ ] Rôles personnalisés par école (interface d'édition des permissions).
