# Mise en production de LAKOL

Ce guide installe LAKOL sur un serveur (VPS) avec Docker. Une seule commande
démarre l'ensemble : HTTPS automatique, application, tâches de fond, base de
données, file de tâches et sauvegardes quotidiennes.

```
Internet ──► Caddy (HTTPS, certificats automatiques, sous-domaines des écoles)
               │
               ▼
             app (Next.js) ──► PostgreSQL        backup ──► sauvegarde quotidienne
               │                    ▲                          (+ copie S3 facultative)
               ▼                    │
             Redis ◄──── worker (WhatsApp, emails, rappels, abonnements)
```

## 1. Ce qu'il faut avant de commencer

| Élément            | Recommandation                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serveur            | Ubuntu 24.04, 2 vCPU, **4 Go de RAM** si les images sont construites sur le serveur (2 Go suffisent avec les images publiées par la CI), 40 Go de disque |
| Domaine            | ex. `lakol.ml`, avec accès à la zone DNS                                                                                                                 |
| WhatsApp Business  | compte Meta Business vérifié, numéro de téléphone dédié (non utilisé dans l'application WhatsApp)                                                        |
| Email              | compte [Resend](https://resend.com) et domaine d'envoi                                                                                                   |
| Stockage hors site | recommandé : un bucket [Cloudflare R2](https://developers.cloudflare.com/r2/) (ou compatible S3) pour les copies de sauvegarde                           |

## 2. DNS

Dans la zone du domaine, faire pointer **le domaine et tous ses sous-domaines** vers le serveur :

| Type | Nom | Valeur        |
| ---- | --- | ------------- |
| A    | `@` | IP du serveur |
| A    | `*` | IP du serveur |

(et les mêmes en `AAAA` si le serveur a une IPv6). Le sous-domaine `*` permet
l'accès `ecole-x.lakol.ml` : Caddy obtient le certificat de chaque école à sa
première visite, après vérification par l'application que l'école existe.

## 3. Préparer le serveur

```bash
# Docker et le plugin compose
curl -fsSL https://get.docker.com | sh

# Pare-feu : SSH, HTTP, HTTPS seulement
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable

# Mises à jour de sécurité automatiques
apt install -y unattended-upgrades

# Code de l'application
git clone https://github.com/AbdoussamadAgAlhousseini/LAKOL.git /opt/lakol
cd /opt/lakol
cp .env.production.example .env.production
chmod 600 .env.production
```

## 4. WhatsApp Business (Meta Cloud API)

1. Dans [Meta for Developers](https://developers.facebook.com/), créer une application de type **Business** et lui ajouter le produit **WhatsApp**.
2. Ajouter le numéro de l'école ou de LAKOL, et noter son **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
3. Dans Business Manager, créer un **utilisateur système** (administrateur), lui attribuer l'application et générer un **jeton permanent** avec les permissions `whatsapp_business_messaging` et `whatsapp_business_management` → `WHATSAPP_ACCESS_TOKEN`.
4. Paramètres de l'application → Général : copier la **clé secrète** → `WHATSAPP_APP_SECRET`.
5. **Webhook** (WhatsApp → Configuration) :
   - URL de rappel : `https://lakol.ml/api/webhooks/whatsapp`
   - Jeton de vérification : une chaîne aléatoire (`openssl rand -hex 16`) → `WHATSAPP_VERIFY_TOKEN`
   - S'abonner au champ **messages** (statuts envoyé, remis, lu, échec).
     L'application doit déjà tourner pour que Meta valide l'URL (faire cette étape après la section 7).
6. **Modèle de message** (WhatsApp Manager → Modèles) : LAKOL écrit en premier aux parents, ce que Meta n'autorise
   qu'avec un modèle approuvé. Créer :
   - Nom : `lakol_notification` → `WHATSAPP_TEMPLATE_NAME`
   - Catégorie : **Utilitaire**
   - Langue : **Français** (puis une version **Anglais** si besoin → `WHATSAPP_TEMPLATE_LANGUAGES="fr,en"`)
   - Corps :
     ```
     Bonjour, voici une information de votre école :

     *{{1}}*
     {{2}}

     Détails : {{3}}

     Message envoyé par LAKOL.
     ```
   - Exemples pour la validation : `{{1}}` = `Absence — Aminata`, `{{2}}` = `Aminata a été marquée absente ce matin en 7e A.`, `{{3}}` = `https://lakol.ml/fr/les-etoiles/attendance`.

   Tant que le modèle n'est pas approuvé (de quelques minutes à 24 h), les envois WhatsApp échouent et apparaissent
   en « Échec » dans **Annonces → Suivi des envois** ; le bouton « Renvoyer les échecs » les relance ensuite.

> Les codes de vérification (mot de passe oublié) passent aussi par ce modèle. Meta recommande à terme un modèle
> de catégorie « Authentification » dédié (voir `TODO.md`).

## 5. Email (Resend)

1. Ajouter le domaine d'envoi dans Resend et créer les enregistrements DNS indiqués (SPF, DKIM).
2. Créer une clé d'API → `RESEND_API_KEY`.
3. `EMAIL_FROM="LAKOL <no-reply@lakol.ml>"` (adresse du domaine vérifié).

## 6. Fichiers et sauvegardes

- **Fichiers envoyés** (photos, pièces jointes, bulletins) : par défaut dans le volume Docker `storage`, sauvegardé
  chaque nuit. Pour un stockage objet, renseigner `STORAGE_PROVIDER="s3"` et les variables `S3_*` (Cloudflare R2 :
  endpoint `https://<compte>.r2.cloudflarestorage.com`, région `auto`).
- **Sauvegardes** : le service `backup` fait chaque nuit (à `BACKUP_HOUR` UTC) un `pg_dump` de la base et une
  archive des fichiers dans `./backups` (30 quotidiennes, 12 mensuelles). **Activer la copie hors serveur** avec
  `BACKUP_S3_URI` et les clés `AWS_*` (un bucket R2 dédié, avec versionnement) : une sauvegarde qui reste sur le
  même serveur ne protège pas d'une panne de celui-ci.

## 7. Configurer et démarrer

Compléter `.env.production` (chaque variable y est commentée), notamment :

```bash
openssl rand -hex 24   # pour POSTGRES_PASSWORD
openssl rand -hex 16   # pour WHATSAPP_VERIFY_TOKEN
```

Puis démarrer :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f migrate app worker
```

Au démarrage :

1. `migrate` applique les migrations, crée le catalogue des permissions, les formules (Essai, Standard, Premium) et
   le compte super admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Il ne crée **aucune donnée de démonstration**
   (ne jamais lancer `pnpm db:seed` en production : il efface la base).
2. `app` et `worker` vérifient la configuration (`DEPLOY_ENV=production`) : une variable manquante arrête le
   démarrage avec un message explicite dans les logs.
3. Caddy obtient le certificat HTTPS du domaine.

Vérifier :

- `https://lakol.ml/api/health` → `{"status":"ok","db":"ok","redis":"ok"}`
- se connecter sur `https://lakol.ml` avec le compte super admin, puis **changer son mot de passe**
  (Mon compte) et retirer `ADMIN_PASSWORD` de `.env.production`.
- terminer le webhook WhatsApp (section 4, étape 5).

### Images publiées par la CI (serveur à 2 Go)

La CI publie les images sur GHCR pour chaque version taguée (`git tag v1.0.0 && git push --tags`). Sur le serveur :

```bash
# dans .env.production
LAKOL_REGISTRY="ghcr.io/abdoussamadagalhousseini/"
LAKOL_VERSION="v1.0.0"

docker login ghcr.io   # si le paquet est privé (jeton GitHub avec read:packages)
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
```

## 8. Première école

- **Par la plateforme** : `/fr/admin` → Écoles → Nouvelle école. Le directeur reçoit ses accès par WhatsApp.
- **En libre-service** : `https://lakol.ml/fr/creer-mon-ecole` (essai de 30 jours, puis assistant de démarrage).

## 9. Mettre à jour

```bash
cd /opt/lakol
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Les migrations et la synchronisation des permissions s'appliquent automatiquement (service `migrate`) avant le
redémarrage de l'application. Avec les images GHCR : changer `LAKOL_VERSION`, puis `pull` et `up -d --no-build`.

**Retour arrière** : revenir à la version précédente (`git checkout <tag>` ou `LAKOL_VERSION`), et restaurer la
sauvegarde de la veille si une migration a modifié les données.

## 10. Sauvegardes : vérifier et restaurer

```bash
# Sauvegarde immédiate
docker compose -f docker-compose.prod.yml --env-file .env.production exec backup backup.sh
ls -lh backups/daily

# Restauration (application arrêtée)
docker compose -f docker-compose.prod.yml --env-file .env.production stop app worker
docker compose -f docker-compose.prod.yml --env-file .env.production exec backup \
  restore.sh /backups/daily/lakol-db-AAAAMMJJ-HHMM.dump /backups/daily/lakol-files-AAAAMMJJ-HHMM.tar.gz
docker compose -f docker-compose.prod.yml --env-file .env.production start app worker
```

**Tester une restauration chaque trimestre** sur une base vierge : une sauvegarde jamais restaurée n'est pas une
sauvegarde.

## 11. Surveillance

- Sonde : `https://lakol.ml/api/health` (503 si la base ne répond pas) dans un service de surveillance
  (UptimeRobot, Better Stack…), alerte par SMS ou email.
- Logs (JSON, une ligne par événement) : `docker compose … logs -f app worker caddy`.
- Envois WhatsApp/email : **Annonces → Suivi des envois** (statuts envoyé, remis, lu, échec).
- Disque : `df -h` et taille de `./backups` ; les volumes Docker sont dans `/var/lib/docker/volumes`.

## 12. Dépannage

| Symptôme                                    | Piste                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `app` ou `worker` redémarre en boucle       | `logs app` : « configuration : … manquant » indique la variable à compléter                                                                 |
| WhatsApp en « Échec »                       | modèle non approuvé ou mal nommé, jeton expiré, quota de la formule atteint (bascule vers l'email) ; le détail de l'erreur Meta est affiché |
| Statuts WhatsApp jamais « Remis » ni « Lu » | webhook non abonné au champ `messages`, ou `WHATSAPP_APP_SECRET` incorrect (signature refusée)                                              |
| Pas de certificat pour `ecole-x.lakol.ml`   | enregistrement DNS `*` manquant, ou école inexistante (Caddy demande l'accord de `/api/tls-check`) ; voir `logs caddy`                      |
| Pas d'email                                 | domaine non vérifié chez Resend, `EMAIL_FROM` hors du domaine vérifié                                                                       |

## 13. Liste de contrôle avant d'ouvrir aux écoles

- [ ] DNS `@` et `*` pointent vers le serveur ; `https://lakol.ml` répond avec un certificat valide
- [ ] `/api/health` → ok
- [ ] Mot de passe du super admin changé, `ADMIN_PASSWORD` retiré de `.env.production`
- [ ] Modèle WhatsApp `lakol_notification` approuvé ; webhook validé et abonné à `messages`
- [ ] Test réel : une école de test, un parent avec votre numéro → absence saisie → WhatsApp reçu → statut « Lu »
- [ ] Email reçu (accès d'un compte avec email)
- [ ] Copie des sauvegardes hors serveur activée (`BACKUP_S3_URI`) et une restauration testée
- [ ] Surveillance de `/api/health` en place
- [ ] Prix des formules vérifiés dans `/fr/admin/plans`
