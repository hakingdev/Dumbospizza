#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-dumbospizza.de}"
EMAIL="${EMAIL:-}"
APP_DIR="${APP_DIR:-/opt/dumbospizza}"
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
ENV_FILE="${ENV_FILE:-$APP_DIR/deploy/.env.production}"
SEED_DATA="${SEED_DATA:-false}"
CREATE_ADMIN="${CREATE_ADMIN:-false}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root: sudo $0"
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  echo "EMAIL is required for Let's Encrypt. Example: EMAIL=you@dumbospizza.de"
  exit 1
fi

echo "==> Installing system packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git nginx ufw

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "==> Ensuring app directory exists"
mkdir -p "$APP_DIR"

if [[ -n "$REPO_URL" ]]; then
  if [[ ! -d "$APP_DIR/.git" ]]; then
    echo "==> Cloning repo"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
  else
    echo "==> Pulling latest changes"
    git -C "$APP_DIR" fetch origin "$REPO_BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH"
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Creating .env.production from environment variables"
  REQUIRED_VARS=(
    NEXTAUTH_URL
    NEXTAUTH_SECRET
    NEXT_PUBLIC_URL
    STRIPE_SECRET_KEY
    STRIPE_PUBLIC_KEY
  )
  for VAR in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!VAR:-}" ]]; then
      echo "Missing $VAR. Provide env vars or create $ENV_FILE manually."
      exit 1
    fi
  done
  cat > "$ENV_FILE" <<EOF
NEXTAUTH_URL=${NEXTAUTH_URL}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXT_PUBLIC_URL=${NEXT_PUBLIC_URL}
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}
TELEGRAM_TOKEN=${TELEGRAM_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_PUBLIC_KEY=${STRIPE_PUBLIC_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-}
SEED_SECRET_KEY=${SEED_SECRET_KEY:-production_seed_key}
EOF
fi

echo "==> Configuring Nginx"
cat > /etc/nginx/sites-available/pizza.conf <<EOF
server {
  server_name ${DOMAIN} www.${DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF

ln -sf /etc/nginx/sites-available/pizza.conf /etc/nginx/sites-enabled/pizza.conf
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl restart nginx

echo "==> Configuring firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo "==> Installing Certbot"
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" \
  --non-interactive --agree-tos -m "${EMAIL}"

echo "==> Starting app via Docker Compose"
cd "$APP_DIR/deploy"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Waiting for app to start"
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:3000" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if [[ "$SEED_DATA" == "true" ]]; then
  echo "==> Seeding database"
  curl -fsS "http://127.0.0.1:3000/api/seed?key=${SEED_SECRET_KEY:-production_seed_key}" || true
fi

if [[ "$CREATE_ADMIN" == "true" ]]; then
  echo "==> Creating admin user"
  curl -fsS "http://127.0.0.1:3000/api/create-admin" || true
fi

echo "==> Done. Site should be available at https://${DOMAIN}"

