# Aperçu en ligne sur Vercel (sans serveur ni Docker)

Ce guide met LAKOL en ligne gratuitement, avec les écoles de démonstration, pour le montrer ou le tester depuis n'importe quel ordinateur ou téléphone. Il ne demande ni Docker ni installation sur votre ordinateur : tout se fait dans le navigateur.

Comptez environ 20 minutes. Il faut trois comptes gratuits, que vous pouvez tous créer avec votre compte GitHub :

- **Neon** : la base de données ;
- **GitHub** : vous l'avez déjà, il chargera les données de démonstration ;
- **Vercel** : il fait tourner l'application.

> C'est un **aperçu**, pas la version de production. N'y mettez jamais de vraies données d'élèves ou de parents. Les mots de passe de démonstration sont écrits dans le README.

## Étape 1 — Créer la base de données (Neon)

1. Allez sur https://neon.tech et cliquez sur **Sign up**, puis **Continue with GitHub**.
2. Créez un projet :
   - nom : `lakol-demo` ;
   - région : **AWS Europe Central 1 (Frankfurt)** ;
   - version de Postgres : celle proposée par défaut.
3. Sur la page du projet, cliquez sur **Connect**.
4. Dans la fenêtre qui s'ouvre, **désactivez l'option « Connection pooling »**.
5. Copiez l'adresse affichée. Elle commence par `postgresql://` et se termine par `?sslmode=require`.

Cette adresse contient le mot de passe de la base. Gardez-la pour vous : ne l'envoyez pas dans une conversation, collez-la seulement aux deux endroits indiqués ci-dessous.

## Étape 2 — Charger les écoles de démonstration (GitHub)

1. Sur GitHub, ouvrez le dépôt **LAKOL**, puis **Settings**, **Secrets and variables**, **Actions**.
2. Cliquez sur **New repository secret** et remplissez :
   - **Name** : `DEMO_DATABASE_URL`
   - **Secret** : l'adresse copiée à l'étape 1
   - puis **Add secret**.
3. Ouvrez l'onglet **Actions** du dépôt. À gauche, choisissez **Base de démonstration**, puis **Run workflow**.
4. Dans la case, tapez `EFFACER` en majuscules, puis cliquez sur le bouton vert **Run workflow**.
5. Attendez environ 2 minutes. Une coche verte signifie que les tables sont créées et les écoles chargées.

Vous pouvez relancer cette action à tout moment pour remettre la démonstration à zéro.

## Étape 3 — Mettre l'application en ligne (Vercel)

1. Allez sur https://vercel.com et cliquez sur **Sign Up**.
   - Choisissez l'offre **Hobby** (gratuite).
   - Connectez-vous avec **Continue with GitHub**.
2. Cliquez sur **Add New…**, puis **Project**.
   - Si LAKOL n'apparaît pas dans la liste, cliquez sur **Configure GitHub App** et donnez accès au dépôt LAKOL.
   - Cliquez ensuite sur **Import** à côté de LAKOL.
3. Laissez les réglages proposés (Framework : Next.js).
4. Ouvrez **Environment Variables** et ajoutez ces trois variables :

   | Name           | Value                                                            |
   | -------------- | ---------------------------------------------------------------- |
   | `DATABASE_URL` | l'adresse Neon de l'étape 1                                      |
   | `STORAGE_DIR`  | `/tmp/lakol-storage`                                             |
   | `APP_URL`      | `https://lakol.vercel.app` pour l'instant (corrigée à l'étape 4) |

5. Cliquez sur **Deploy** et attendez 3 à 5 minutes.

## Étape 4 — Corriger l'adresse et tester

1. À la fin du déploiement, Vercel affiche l'adresse du site, par exemple `https://lakol-abc123.vercel.app`.
2. Mettez cette adresse dans la variable `APP_URL` :
   - **Settings**, **Environment Variables** ;
   - modifiez `APP_URL` ;
   - puis **Deployments**, menu **…** du dernier déploiement, **Redeploy**.
3. Ouvrez l'adresse du site et connectez-vous :
   - Directeur : `directeur@les-etoiles.lakol.test`, mot de passe `Lakol2025!`
   - Parent : `70 00 00 01`, mot de passe `Parent2025!`
   - Les autres comptes sont dans `README.md`.

Le site s'ouvre aussi sur téléphone. Sur Android, dans Chrome, il peut même être installé comme une application.

Chaque modification envoyée sur la branche `main` de GitHub met l'aperçu à jour automatiquement.

## Ce qui marche et ce qui ne marche pas dans l'aperçu

| Fonctionne                                                         | Ne fonctionne pas (seulement sur le VPS)                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Tous les espaces : direction, professeurs, parents, élèves, admin  | Adresses par école (`les-etoiles.lakol.com`) : on choisit l'école à la connexion |
| Notes, bulletins PDF, paiements, reçus PDF, exports Excel          | Rappels automatiques (devoirs, impayés) et envois programmés                     |
| Notifications dans l'application                                   | Fichiers déposés (photos, devoirs) : ils disparaissent au bout d'un moment       |
| WhatsApp et emails **simulés** (visibles dans Vercel, onglet Logs) | Vrais envois WhatsApp et emails                                                  |

La première ouverture après une longue pause peut prendre quelques secondes : la base gratuite Neon se met en veille quand personne ne l'utilise.

## En cas de problème

- **L'action GitHub est rouge**, avec « Secret DEMO_DATABASE_URL absent » : le secret de l'étape 2 est mal nommé. Le nom doit être exactement `DEMO_DATABASE_URL`.
- **L'action GitHub est rouge**, avec une erreur de connexion : recopiez l'adresse Neon, avec l'option « Connection pooling » désactivée.
- **Le site affiche une erreur** ou **« Identifiant ou mot de passe incorrect »** : vérifiez que l'action de l'étape 2 est verte et que `DATABASE_URL` sur Vercel est exactement la même adresse que le secret GitHub.
- **Le déploiement Vercel échoue** : ouvrez le déploiement, puis **Building**. Copiez les dernières lignes rouges, **sans les adresses ni les mots de passe**, et envoyez-les-moi.

> Bon à savoir : l'offre gratuite de Vercel est réservée à un usage non commercial. Elle convient pour une démonstration ; les écoles clientes seront hébergées sur le VPS (voir `DEPLOIEMENT.md`).
