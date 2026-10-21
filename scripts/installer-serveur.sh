#!/usr/bin/env bash
# Installation de LAKOL sur un VPS Ubuntu 24.04 neuf, en une commande (en root) :
#
#   curl -fsSL https://raw.githubusercontent.com/AbdoussamadAgAlhousseini/LAKOL/main/scripts/installer-serveur.sh -o installer.sh
#   bash installer.sh
#
# Le script pose trois questions (domaine, email, mot de passe du super admin),
# installe Docker, le pare-feu et les mises à jour automatiques, récupère le code
# dans /opt/lakol, crée .env.production et démarre LAKOL avec HTTPS.
# WhatsApp et email démarrent en mode simulé (messages dans les logs) : on les
# branche ensuite en complétant .env.production (voir DEPLOIEMENT.md, sections 4 et 5).
# Relancer le script ne touche pas à un .env.production existant : il met à jour le code et redémarre.
set -euo pipefail

REPO="https://github.com/AbdoussamadAgAlhousseini/LAKOL.git"
DIR="/opt/lakol"
ENV_FILE="$DIR/.env.production"

info() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m/!\\ %s\033[0m\n' "$*"; }
fail() {
  printf '\033[1;31mErreur : %s\033[0m\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "lancez le script en root (commande : sudo bash installer.sh)."
grep -q '^ID=ubuntu' /etc/os-release || warn "Ce script est prévu pour Ubuntu 24.04 ; il peut échouer sur un autre système."

# ── Questions (seulement à la première installation) ──────────────────────────
if [ ! -s "$ENV_FILE" ]; then
  echo
  echo "Installation de LAKOL. Trois questions, puis tout est automatique (10 à 20 minutes)."
  echo
  read -rp "Nom de domaine (ex. lakol.com, sans www ni https) : " DOMAIN
  DOMAIN="$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^www\.##; s#/.*$##')"
  [[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || fail "nom de domaine invalide : $DOMAIN"

  read -rp "Votre adresse email (compte super admin et alertes HTTPS) : " EMAIL
  [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "adresse email invalide : $EMAIL"

  while true; do
    read -rsp "Mot de passe du super admin (12 caractères au moins, sans \" \\ \$ ni \`) : " ADMIN_PASSWORD
    echo
    read -rsp "Retapez le mot de passe : " CONFIRM
    echo
    if [ "$ADMIN_PASSWORD" != "$CONFIRM" ]; then
      warn "Les deux mots de passe sont différents, recommencez."
    elif [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
      warn "Trop court : 12 caractères au moins."
    elif [[ "$ADMIN_PASSWORD" == *[\"\\\$\`]* ]]; then
      warn "Les caractères \" \\ \$ et \` ne sont pas acceptés."
    else
      break
    fi
  done
fi

# ── Système ──────────────────────────────────────────────────────────────────
info "Mise à jour du système et outils de base"
export DEBIAN_FRONTEND=noninteractive
# Au premier démarrage, Ubuntu fait ses propres mises à jour : attendre la fin plutôt qu'échouer.
APT=(apt-get -o DPkg::Lock::Timeout=600)
"${APT[@]}" update -q
"${APT[@]}" install -yq git curl openssl ufw unattended-upgrades ca-certificates
dpkg-reconfigure -f noninteractive unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  info "Installation de Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# La construction de l'application demande de la mémoire : un fichier d'échange évite un échec sur un petit serveur.
if ! swapon --show | grep -q .; then
  info "Création d'un fichier d'échange de 2 Go"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

info "Pare-feu : SSH, HTTP et HTTPS uniquement"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

# ── Code ─────────────────────────────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
  info "Mise à jour du code dans $DIR"
  git -C "$DIR" pull --ff-only
else
  info "Téléchargement du code dans $DIR"
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

# ── Configuration ────────────────────────────────────────────────────────────
if [ ! -s "$ENV_FILE" ]; then
  info "Création de la configuration $ENV_FILE"
  umask 077
  # Remplace la valeur des clés données, en gardant le reste du modèle (et ses commentaires).
  DOMAIN="$DOMAIN" EMAIL="$EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    POSTGRES_PASSWORD="$(openssl rand -hex 24)" VERIFY_TOKEN="$(openssl rand -hex 16)" \
    awk '
      function set(key, value) { values[key] = value }
      BEGIN {
        set("ROOT_DOMAIN", ENVIRON["DOMAIN"])
        set("APP_URL", "https://" ENVIRON["DOMAIN"])
        set("ACME_EMAIL", ENVIRON["EMAIL"])
        set("ADMIN_EMAIL", ENVIRON["EMAIL"])
        set("ADMIN_PASSWORD", ENVIRON["ADMIN_PASSWORD"])
        set("POSTGRES_PASSWORD", ENVIRON["POSTGRES_PASSWORD"])
        set("WHATSAPP_VERIFY_TOKEN", ENVIRON["VERIFY_TOKEN"])
        set("WHATSAPP_PROVIDER", "mock")
        set("EMAIL_PROVIDER", "mock")
        set("EMAIL_FROM", "LAKOL <no-reply@" ENVIRON["DOMAIN"] ">")
      }
      {
        split($0, kv, "=")
        if ($0 ~ /^[A-Z_]+=/ && (kv[1] in values)) print kv[1] "=\"" values[kv[1]] "\""
        else print
      }
    ' .env.production.example >"$ENV_FILE.tmp"
  chmod 600 "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
fi

DOMAIN="$(grep '^ROOT_DOMAIN=' "$ENV_FILE" | cut -d'"' -f2)"

# ── DNS ──────────────────────────────────────────────────────────────────────
SERVER_IP="$(curl -4fsS --max-time 10 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
if [ -n "$SERVER_IP" ] && [ "$DNS_IP" != "$SERVER_IP" ]; then
  warn "Le domaine $DOMAIN ne pointe pas encore vers ce serveur ($SERVER_IP ; DNS actuel : ${DNS_IP:-aucun})."
  warn "LAKOL démarre quand même ; le cadenas HTTPS arrivera tout seul quand le DNS sera à jour (jusqu'à quelques heures)."
fi

# ── Démarrage ────────────────────────────────────────────────────────────────
info "Construction et démarrage de LAKOL (10 à 20 minutes la première fois)"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
"${COMPOSE[@]}" up -d --build

info "Vérification"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"db":"ok"'; then
    HEALTHY=1
    break
  fi
  sleep 5
done
"${COMPOSE[@]}" ps
[ "${HEALTHY:-0}" = 1 ] || fail "l'application ne répond pas. Envoyez les dernières lignes de : ${COMPOSE[*]} logs --tail 50 migrate app"

cat <<EOF

LAKOL est démarré.

  Adresse          : https://$DOMAIN
  Super admin      : $(grep '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d'"' -f2)
  Configuration    : $ENV_FILE (secrets : ne jamais la partager)

À faire maintenant :
  1. Ouvrir https://$DOMAIN, se connecter, puis changer le mot de passe (Mon compte).
  2. Retirer ensuite le mot de passe du fichier :  sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=""/' $ENV_FILE
  3. WhatsApp et email sont simulés : messages visibles avec
       cd $DIR && ${COMPOSE[*]} logs -f worker

EOF
