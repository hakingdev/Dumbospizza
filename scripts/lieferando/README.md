# Lieferando: массовое вкл/выкл позиций MakiLove

Выключает/включает все позиции MakiLove в Partner Hub (страница
«Artikelverfügbarkeit»). Работает через Playwright с сохранённой сессией —
логин руками нужен один раз.

Две обёртки над общим ядром (`core.mjs`):

- **`toggle.mjs`** — ручной CLI;
- **`agent.mjs`** — демон для кассового ПК: выполняет команды из панели
  Telegram-стоп-бота (кнопка «🛵 Lieferando MakiLove»).

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
| `HEADLESS` | `1` | `0` — с окном, если ботозащита Hub не пускает headless |

Запускать вместе с print-agent (тот же автозапуск). Если агент молчит дольше
2 минут, панель бота показывает «агент не на связи».

## Ручные команды

```bash
node toggle.mjs list   # dry run: что видим и что включено
node toggle.mjs off    # выключить всё MakiLove (список → state/disabled.json)
node toggle.mjs on     # включить обратно ровно то, что выключали
```

## Важно знать

- Позиция считается MakiLove, если «makilove» есть в названии её **категории**
  или её самой (регистр/пробелы не важны). Новые категории Makilove
  подхватываются сами.
- Выключение в Hub действует **до конца дня** — утром Lieferando сам вернёт
  позиции в продажу.
- `on` включает только то, что выключал скрипт (`state/disabled.json`) —
  выключенное руками не трогает.
- «Сессия истекла» в отчёте бота → на кассовом ПК: `node toggle.mjs login`.
- Селекторы DOM (`SEL` в core.mjs) сняты с реального Hub в августе 2026;
  если Hub переверстают — чинить там.

Серверная часть: `lib/lieferando-makilove.ts` (очередь команд),
`app/api/lieferando/agent` (обмен с агентом), панель — `lib/telegram-control.ts`.
