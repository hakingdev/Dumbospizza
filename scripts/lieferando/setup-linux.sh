#!/usr/bin/env bash
# Установка агента Lieferando на Ubuntu 22.04/24.04 (VDS без экрана).
#
#   scp -r scripts/lieferando root@СЕРВЕР:/root/lieferando
#   ssh root@СЕРВЕР 'bash /root/lieferando/setup-linux.sh'
#
# Что делает: Node 22, Chromium для Playwright + системные библиотеки, Xvfb
# (на случай HEADLESS=0), отдельный пользователь lieferando, файлы агента
# в /opt/lieferando, systemd-сервис lieferando-agent с автоперезапуском
# (нужен и для самообновления: агент выходит — systemd поднимает).
#
# После установки:
#   1) session.json с кассы → /opt/lieferando/session.json
#      (на кассе: node toggle.mjs export-session — агент там остановить)
#   2) lief import-session session.json      (проверит, что Hub пускает)
#   3) lief list                             (должен показать позиции MakiLove)
#   4) systemctl start lieferando-agent && journalctl -fu lieferando-agent
set -euo pipefail

APP_DIR=/opt/lieferando
SVC_USER=lieferando
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ $EUID -eq 0 ]] || { echo "Запускать от root (sudo bash setup-linux.sh)"; exit 1; }

echo "== Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg xvfb >/dev/null

echo "== Node 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "== Пользователь и файлы"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd -r -m -d "$APP_DIR" -s /bin/bash "$SVC_USER"
mkdir -p "$APP_DIR"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  cp "$SRC_DIR"/{agent.mjs,core.mjs,toggle.mjs,package.json,package-lock.json} "$APP_DIR/"
fi
if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -f "$SRC_DIR/.env" ]]; then
    cp "$SRC_DIR/.env" "$APP_DIR/.env"
  else
    read -r -p "LIEFERANDO_AGENT_SECRET (= PRINT_AGENT_SECRET): " secret
    printf 'LIEFERANDO_AGENT_SECRET=%s\nHEADLESS=1\n' "$secret" > "$APP_DIR/.env"
  fi
fi
if [[ "$SRC_DIR" != "$APP_DIR" && -f "$SRC_DIR/session.json" && ! -f "$APP_DIR/session.json" ]]; then
  cp "$SRC_DIR/session.json" "$APP_DIR/"
fi
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "== npm + Chromium"
sudo -u "$SVC_USER" -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund >/dev/null && npx playwright install chromium >/dev/null"
# системные библиотеки Chromium ставятся от root
(cd "$APP_DIR" && npx playwright install-deps chromium >/dev/null)

echo "== systemd"
cat > /etc/systemd/system/lieferando-agent.service <<UNIT
[Unit]
Description=Lieferando MakiLove agent (Dumbo Pizza stop-bot executor)
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP_DIR
Environment=HOME=$APP_DIR
# xvfb-run даёт виртуальный дисплей: HEADLESS=0 в .env включает режим «с окном»,
# если ботозащита Hub не пускает headless. При HEADLESS=1 он просто не мешает.
ExecStart=/usr/bin/xvfb-run -a /usr/bin/node agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable lieferando-agent >/dev/null

# удобная обёртка: lief <команда> = node toggle.mjs от имени сервисного пользователя
cat > /usr/local/bin/lief <<'WRAP'
#!/usr/bin/env bash
exec sudo -u lieferando -H bash -c "cd /opt/lieferando && node toggle.mjs $*"
WRAP
chmod +x /usr/local/bin/lief

echo
echo "Готово. Дальше:"
echo "  1) session.json с кассы → $APP_DIR/session.json  (chown lieferando)"
echo "  2) lief import-session session.json"
echo "  3) lief list"
echo "  4) systemctl start lieferando-agent && journalctl -fu lieferando-agent"
