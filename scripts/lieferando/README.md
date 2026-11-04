# Lieferando: вкл/выкл позиций и размеров из стоп-бота

Переключает доступность в Partner Hub (страница «Artikelverfügbarkeit»):
все позиции MakiLove разом, один размер у всех пицц («30 cm», «ca. 27x37»)
или отдельные позиции по имени. Работает через Playwright с сохранённой
сессией — логин руками нужен один раз.

Две обёртки над общим ядром (`core.mjs`):

- **`toggle.mjs`** — ручной CLI;
- **`agent.mjs`** — демон (VDS или кассовый ПК): выполняет команды из панели
  Telegram-стоп-бота (кнопка «🛵 Lieferando MakiLove», экраны размеров/позиций).

Команда агенту = `{ action: off|on, target }`, где `target.kind`:

| kind | что переключает | как ищет в Hub |
|---|---|---|
| `makilove` | все позиции категорий «Makilove …» | «makilove» в имени категории/позиции |
| `size` (`label`) | вариант строки (`[data-test-id="variation"]`) у всех строк вне MakiLove | по числам подписи: «30 cm» ↔ «30 cm», «ca. 27x37» ↔ «Ca. 27×37 cm (entspricht ca. Ø 36 cm Pizza)», «6 Stk» ↔ «6stk» |
| `item` (`names[]`) | общий переключатель строки | имя без «Pizza», «(rund)», «Neu:», веса/порции, vegetarisch/vegan, регистра и пунктуации: «Hawaiian» → и «Hawaiian Pizza», и «Hawaiian Pizza (rund)» |
| `catalog` | ничего — снимок всех категорий (имя, общий переключатель, варианты) | — ; снимок уходит POST'ом на `/api/lieferando/agent/catalog` |

Сервер отдаёт `size`/`item` только агенту с заголовком `X-Agent-Caps: targets`,
`catalog` — с `catalog` (старый агент до самообновления выполнил бы их как
MakiLove off/on).

## Ежедневная сверка каталога (ноябрь 2026)

Агент сам снимает каталог Hub раз в сутки — в `LIEFERANDO_CATALOG_HOUR`
(по умолчанию 9:00 Europe/Berlin), когда очередь пуста; день последнего
снимка — в `state/catalog-day.json`. Цикл агента последовательный, поэтому с
утренним перевыключением бессрочного стоп-листа (сервер ставит его после 08:30)
второй браузер не откроется. Сервер (`lib/lieferando/catalog.ts`) сверяет
снимок с товарами сайта той же нормализацией имён (`itemKey` — копия в
`lib/lieferando/item-key.ts`, тождество сторожит тест) и шлёт в группу
стоп-бота **только изменения**: новое в Hub без пары на сайте, пропавшее из
Hub, несовпадающие имена. Позиции только из Hub (Burger, «Neu: Sushi
Balls…») появляются в боте на экране «📋 Позиции» с пометкой 🛵. Кнопка
«🛵 Сверить с Lieferando» там же ставит команду `catalog` вне расписания.

Вручную: `node toggle.mjs catalog` → `state/catalog.json`; с `--post` — ещё и
на сервер (нужны секрет и `API_BASE_URL`, как у агента).

## Установка на кассовом ПК (один раз)

```bash
cd scripts/lieferando
npm install
npx playwright install chromium
node toggle.mjs login     # войти в Partner Hub, закрыть окно
```

## Агент (для кнопки в боте)

```bash
set LIEFERANDO_AGENT_SECRET=<тот же PRINT_AGENT_SECRET>   # Windows
npm run agent
```

Переменные:

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `LIEFERANDO_AGENT_SECRET` | `PRINT_AGENT_SECRET` | общий секрет с сервером |
| `API_BASE_URL` | `https://www.dumbospizza.de` | строго **www** — apex отдаёт 308 |
| `LIEFERANDO_POLL_MS` | `20000` | период поллинга |
| `LIEFERANDO_CATALOG_HOUR` | `9` | час (Europe/Berlin) ежедневного снимка каталога; `-1` — выключить |
| `HEADLESS` | `1` | `0` — с окном, если ботозащита Hub не пускает headless |

Запускать вместе с print-agent (тот же автозапуск). Если агент молчит дольше
2 минут, панель бота показывает «агент не на связи».

## Ручные команды

```bash
node toggle.mjs list                      # dry run: позиции MakiLove и их состояние
node toggle.mjs off                       # выключить всё MakiLove (список → state/disabled.json)
node toggle.mjs on                        # включить все позиции MakiLove
node toggle.mjs find-size "30 cm"         # dry run: где есть размер и что бы переключилось
node toggle.mjs set-size "30 cm" off      # выключить размер у всех строк вне MakiLove (on — включить)
node toggle.mjs find-item "Hawaiian"      # dry run: какие строки Hub совпадают с именем сайта
node toggle.mjs set-item "Hawaiian" off   # общий переключатель этих строк (несколько имён — через запятую)
node toggle.mjs catalog [--post]          # снимок всего каталога (ничего не переключает) → state/catalog.json [и на сервер]
```

## Важно знать

- Позиция считается MakiLove, если «makilove» есть в названии её **категории**
  или её самой (регистр/пробелы не важны). Новые категории Makilove
  подхватываются сами.
- Выключение в Hub действует **до конца дня** — утром Lieferando сам вернёт
  позиции и размеры в продажу.
- `on` для MakiLove включает **все** позиции MakiLove (список
  `state/disabled.json` — только журнал).
- `set-size`/`set-item` обходят все категории, кроме «Makilove …», и
  переключают только то, что в другом состоянии; отчёт — сколько переключено,
  сколько уже было, в каких категориях, что не найдено.
- «Сессия истекла» в отчёте бота → на кассовом ПК: `node toggle.mjs login`.
- Селекторы DOM (`SEL` в core.mjs) сняты с реального Hub в августе 2026;
  если Hub переверстают — чинить там.

Серверная часть: `lib/lieferando-makilove.ts` (очередь команд),
`app/api/lieferando/agent` (обмен с агентом), панель — `lib/telegram-control.ts`.


## Автообновление (сент. 2026)

Запускать агента через **start-agent.bat** (двойной клик или в автозагрузку),
а не `node agent.mjs`: агент при старте и раз в час сверяет свои файлы с
сервером (`/api/lieferando/agent/files`), сам скачивает изменившиеся
(agent.mjs, core.mjs, toggle.mjs), проверяет их и перезапускается — bat
поднимает его снова. Копировать файлы на кассовый ПК вручную больше не нужно.

Отключить: `LIEFERANDO_NO_SELF_UPDATE=1` в `.env`.
Версия агента видна в строке «Агент на связи (…, v xxxx)» в панели бота.

## Linux-сервер (VDS) — ноябрь 2026

Агент может жить на Ubuntu-сервере без экрана вместо кассового ПК.
Установка: `scp -r scripts/lieferando root@СЕРВЕР:/root/lieferando` →
`bash /root/lieferando/setup-linux.sh` (Node 22, Chromium, пользователь
`lieferando`, `/opt/lieferando`, systemd-сервис `lieferando-agent`).

Вход в Hub без экрана: на машине, где сессия уже есть (касса, агент
остановлен), `node toggle.mjs export-session` → `session.json` → на сервер →
`lief import-session session.json` (проверит, что Hub пускает, и удалит файл).
`session.json` = доступ к кабинету Lieferando, не пересылать в открытом виде.

Если Hub не пускает headless с IP дата-центра: `HEADLESS=0` в `.env` —
сервис уже запускается под `xvfb-run`, окно откроется на виртуальном дисплее.

Обёртка `lief <команда>` = `node toggle.mjs` от имени сервисного пользователя.
Логи: `journalctl -fu lieferando-agent`.
