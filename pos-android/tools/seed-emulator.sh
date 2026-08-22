#!/usr/bin/env bash
# Настройка ЭМУЛЯТОРА под нативный терминал одним запуском: адрес сервера,
# ключ прибора (берётся из .env.local сайта) и нативный режим — без ручного
# набора на служебном экране.
#
# Только для эмулятора и отладочной сборки: run-as работает лишь с debuggable
# APK, а на боевом приборе настройка делается руками на служебном экране.
# Печать отсюда не стартует: serviceEnabled не трогаем, и на эмуляторе нет
# сервиса Sunmi — терминал только ЧИТАЕТ ленту заказов.
set -euo pipefail

SDK="${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}"
ADB="$SDK/platform-tools/adb"
PKG=de.dumbospizza.pos
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env.local"

SECRET="$(grep -E '^PRINT_AGENT_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')"
if [ -z "$SECRET" ]; then
  echo "PRINT_AGENT_SECRET не найден в $ENV_FILE" >&2
  exit 1
fi

"$ADB" wait-for-device

TMP="$(mktemp)"
cat > "$TMP" <<EOF
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="apiBase">https://www.dumbospizza.de</string>
    <string name="secret">$SECRET</string>
    <string name="uiMode">native</string>
    <string name="deviceId">emu-dev</string>
</map>
EOF

"$ADB" push "$TMP" /data/local/tmp/pos-seed.xml >/dev/null
rm -f "$TMP"
"$ADB" shell "chmod 644 /data/local/tmp/pos-seed.xml"
"$ADB" shell "run-as $PKG mkdir -p shared_prefs"
"$ADB" shell "run-as $PKG cp /data/local/tmp/pos-seed.xml shared_prefs/pos.xml"
"$ADB" shell "rm /data/local/tmp/pos-seed.xml"
"$ADB" shell "am force-stop $PKG"
"$ADB" shell "am start -n $PKG/.KioskActivity" >/dev/null

echo "Готово: терминал перезапущен в НАТИВНОМ режиме, смотрит на www.dumbospizza.de"
echo "Вернуть WebView: тумблер на служебном экране (долгое нажатие в левый верхний угол)"
