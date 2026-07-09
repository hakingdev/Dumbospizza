# PayPal-Zahlungen (Standard Checkout, Orders v2)

PayPal — второй онлайн-способ оплаты рядом с SumUp. SumUp-флоу не изменён.

## Архитектура в двух словах

```
Чекаут: радио «PayPal» → POST /api/orders (paymentMethod='online', pending)
  → модалка (табы SumUp | PayPal, активен ровно один виджет)
  → PayPal-кнопки: createOrder → POST /api/payments/paypal/create-order
       (сумма/валюта считаются ТОЛЬКО на сервере из позиций заказа)
  → onApprove → POST /api/payments/paypal/capture
       (COMPLETED + совпавшая сумма → paymentStatus='completed' → финализация:
        Telegram/печать/лояльность/конверсии — ровно один раз)
  → вебхук /api/payments/paypal/webhook подтверждает/чинит асинхронные исходы
```

Таблицы: `payments` (UNIQUE provider+provider_order_id), `payment_events`
(UNIQUE provider+event_id — дубли вебхуков), `refunds` (request_id
сохраняется ДО вызова API). Суммы в этих таблицах — **integer-центы**.
Код: `lib/paypal/*`, эндпоинты: `app/api/payments/paypal/*`,
возврат: `POST /api/admin/payments/{paymentId}/refund` (только роль admin,
кнопка — в админке заказов).

Статусы платежа: `created → approved → captured → partially_refunded →
refunded`, плюс `failed | cancelled | reversed`. Переходы только вперёд.
«Заказ оплачен» = `orders.payment_status = 'completed'` (как у SumUp).

## Деплой: чек-лист

1. **Миграция БД** (создаёт `payments`, `payment_events`, `refunds`):

   ```bash
   npm run db:migrate   # применяет lib/db/migrations/0007_*.sql
   ```

2. Задать env-переменные (Vercel → Settings → Environment Variables):

   | Ключ | Откуда |
   |---|---|
   | `PAYPAL_ENV` | `sandbox` или `live` |
   | `PAYPAL_CLIENT_ID` | developer.paypal.com → Apps & Credentials → ваше приложение |
   | `PAYPAL_CLIENT_SECRET` | там же («Secret»). Только env, никогда в git/логи |
   | `PAYPAL_WEBHOOK_ID` | см. «Вебхук» ниже |
   | `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | тот же client id (публичный, для кнопок) |
   | `NEXT_PUBLIC_PAYPAL_CURRENCY` | `EUR` |

   Без любого из серверных ключей PayPal-эндпоинты отвечают ошибкой
   (fail-closed), остальной сайт работает как раньше.

3. Настроить вебхук (ниже) и прогнать ручной чек-лист.

## Вебхук: как получить `PAYPAL_WEBHOOK_ID`

1. [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials**
   → выбрать приложение (сначала Sandbox, потом Live).
2. Раздел **Webhooks** → **Add Webhook**.
3. Webhook URL:

   ```
   https://www.dumbospizza.de/api/payments/paypal/webhook
   ```

   ⚠️ **Строго с `www`.** Апекс `dumbospizza.de` отвечает 301-редиректом
   (middleware канонизации), и POST от PayPal до обработчика не дойдёт —
   тот же грабль, что был с Telegram-вебхуком.

4. Подписать события:

   - `PAYMENT.CAPTURE.COMPLETED` — оплата подтверждена (заказ → paid)
   - `PAYMENT.CAPTURE.DENIED` — capture отклонён (заказ → payment failed)
   - `PAYMENT.CAPTURE.DECLINED` — то же (если тип доступен в списке)
   - `PAYMENT.CAPTURE.REFUNDED` — возврат завершён (включая возвраты из PayPal Dashboard)
   - `PAYMENT.CAPTURE.REVERSED` — реверс/чарджбэк (критический алерт в логах)
   - `CHECKOUT.ORDER.APPROVED` — информационное (capture инициирует клиент)

5. После сохранения PayPal покажет **Webhook ID** — это и есть
   `PAYPAL_WEBHOOK_ID`. У Sandbox и Live он разный: при переключении
   `PAYPAL_ENV` менять и его.

Подпись каждого события проверяется через
`/v1/notifications/verify-webhook-signature`; `cert_url` принимается только
с `https://*.paypal.com`. Невалидная подпись → 401 без изменения состояния.
Дубли отбрасываются по `event_id`. На любой не-2xx PayPal ретраит доставку
(до ~3 дней), поэтому временные сбои самовосстанавливаются.

## Sandbox-аккаунты для тестов

1. developer.paypal.com → **Testing Tools → Sandbox Accounts**.
2. Там уже есть пара: `*-facilitator@…` (продавец) и `*-buyer@…` (покупатель).
   При необходимости создать Personal-аккаунт (страна Germany, валюта EUR),
   пароль задать в «View/Edit account».
3. Оплата на сайте: `PAYPAL_ENV=sandbox` + sandbox-ключи приложения; в
   PayPal-окне логиниться **buyer**-аккаунтом.
4. Транзакции продавца смотреть на
   [sandbox.paypal.com](https://www.sandbox.paypal.com) под facilitator-аккаунтом.
5. **Negative testing** (для проверки `INSTRUMENT_DECLINED`): Dashboard →
   Sandbox → App → включить «Negative Testing», слать заголовок моков — либо
   просто выбрать в sandbox-кошельке карту, помеченную как declined.

## Ручной чек-лист (из ТЗ §10)

1. ☐ Оплата sandbox-аккаунтом проходит end-to-end: заказ становится
   оплаченным (в админке «Онлайн» + платёж `captured`), письмо/Telegram ушли.
2. ☐ Отмена в PayPal-окне (`onCancel`) → заказ остаётся `pending`, корзина
   цела, повторная оплата работает (тот же PayPal Order переиспользуется).
3. ☐ Negative testing (отклонённый инструмент) → в том же окне
   `actions.restart()`, повторная попытка другим средством проходит.
4. ☐ Возврат из админки (полный и частичный) → статусы `refunded` /
   `partially_refunded`, вебхук `PAYMENT.CAPTURE.REFUNDED` пришёл (лог
   `[PAYPAL] webhook_capture_refunded`).
5. ☐ Developer Dashboard → Webhooks → **Resend** любого события → в логах
   `webhook_duplicate`, дублей финализации/статусов нет.

## Наблюдаемость и алерты

Структурные логи в лог-дрейн Vercel:

- `[PAYPAL] create_order | capture_success | capture_fail | refund | webhook_*`
- `[PAYPAL][CRITICAL] amount_mismatch` — capture-сумма разошлась с заказом,
  заказ НЕ помечен оплаченным → разбирать руками. **Алерт обязателен.**
- `[PAYPAL][CRITICAL] capture_reversed` — чарджбэк по оплаченному заказу.
- `[SECURITY] paypal-webhook-verify-fail | paypal-*-forbidden | *-rate-limited`
  — на `verify-fail > 0` повесить алерт.

## Ротация ключей

**Client Secret:**

1. developer.paypal.com → Apps & Credentials → приложение → у Secret нажать
   «Generate new secret» (старый остаётся активен параллельно).
2. Обновить `PAYPAL_CLIENT_SECRET` в Vercel → Redeploy.
3. Убедиться, что оплата проходит (чек-лист п.1), затем «Delete» старый
   secret в Dashboard.
4. Токен-кэш в памяти истекает сам (TTL ≤ 9 часов у PayPal, у нас −60s);
   redeploy сбрасывает его сразу.

**Webhook ID** ротации не требует (не секрет в строгом смысле), но при
пересоздании вебхука меняется — обновить env. **Client ID** публичный;
меняется только вместе с созданием нового приложения (тогда обновить оба
`*_CLIENT_ID` и secret).

При компрометации: сгенерировать новый secret и удалить старый немедленно —
активные access-token'ы старого secret'а умирают в течение ≤ 9 часов, для
мгновенного отзыва удалить приложение целиком (создав замену заранее).

## Частые грабли

- **Вебхук молчит** → проверь URL на `www` (см. выше) и `PAYPAL_ENV`
  (sandbox-вебхук не получает live-события и наоборот).
- **`amount_mismatch` в логах** → кто-то изменил заказ между create-order и
  capture, или валюта аккаунта не EUR. Заказ не оплачен — связаться с клиентом,
  вернуть деньги через админку/Dashboard.
- **Оплата прошла, а заказ не paid** (упал сервер между capture и claim) →
  придёт `PAYMENT.CAPTURE.COMPLETED`-вебхук и доведёт заказ до paid; если
  вебхук не настроен — см. `payments.provider_capture_id` и логи.
