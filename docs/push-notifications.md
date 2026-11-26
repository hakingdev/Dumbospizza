# Push notifications (module H «Push»)

Staff write push notifications in the admin (`/admin-v2/push`). They are delivered to the
mobile app «Dumbo Slice» (Expo) through the **Expo Push API**.

```
App ──POST /api/mobile/v1/push/register──▶ push_devices
Admin «Push» ──POST /api/admin/push──▶ push_campaigns ──Expo /push/send──▶ push_tickets
Vercel Cron */5 ──/api/cron/push-campaigns──▶ due campaigns + Expo /getReceipts
```

Code: `lib/push/expo.ts` (transport), `lib/push/validate.ts` (validation, audience),
`lib/push/receipts.ts` (receipt handling), `lib/push/service.ts` (DB), UI `app/admin-v2/push/page.tsx`.

## App contract

### `POST /api/mobile/v1/push/register` (public, rate-limited: 30 / 10 min per IP)

```json
{
  "token": "ExponentPushToken[…]",
  "platform": "ios" | "android",
  "phoneNumber": "+49151…",        // optional, normalized to E.164
  "email": "kunde@example.de",     // optional
  "locale": "de-DE",               // optional
  "appVersion": "1.2.0",           // optional
  "promoOptIn": true               // required boolean
}
```

→ `{ "success": true }`. Idempotent upsert by `token`: it refreshes `lastSeenAt`, re-activates
the device and overwrites phone/email/locale/version/opt-in with the values sent (send `null`
after logout). Errors: `400 { success:false, error }` (bad token format, platform or
`promoOptIn`), `429` with `Retry-After`.

Call it on every app start and whenever the user changes the promo toggle.

### `POST /api/mobile/v1/push/unregister`

`{ "token": "ExponentPushToken[…]" }` → `{ "success": true }` and sets `active = false`.

### Payload the app receives

```json
{
  "title": "…", "body": "…",
  "data": { "kind": "promo" | "order" | "info", "url": "/cart", "promoCode": "DUMBO10", "campaignId": "…" }
}
```

All `data` values are strings. With an image, Android gets `richContent.image`; on iOS the image
needs a notification service extension (`mutableContent: true` is set). Allowed `url` values:
`/product/<id>`, `/menu?category=<slug>`, `/cart`, `/home`, `/order/<id>/tracking`,
`/account/loyalty` (anything else is rejected by the server).

## Who gets what

| kind    | recipients |
|---------|------------|
| `promo` | active devices with `promoOptIn = true` only (§ 7 UWG) |
| `info`  | all active devices (service messages, no advertising) |
| `order` | reserved for order status pushes (not sent by the admin yet) |

The audience can be narrowed to iOS or Android. Non-Expo tokens (old FCM/web rows) are skipped.
Promotions with «Push-Kampagne» (`lib/promotions/campaign.ts`, incl. the Happy Hour cron) now
use the same engine with `kind: promo`, so they also respect the opt-in and show up in the
Push history. The old FCM legacy path was removed (Google shut that API down in 2024).

## Sending

- **Send now** – `POST /api/admin/push` without `scheduledAt`: the campaign is created and sent
  in the same request (batches of 100 to `https://exp.host/--/api/v2/push/send`).
- **Schedule** – with `scheduledAt` (ISO, max 60 days ahead). The cron sends it within 5 minutes.
  Scheduled campaigns can be cancelled or sent immediately from the history
  (`POST /api/admin/push/:id { action: "cancel" | "send-now" }`).
- **Test** – `POST /api/admin/push/test` with the composer content plus `token` or
  `phoneNumber`. Goes to that device only, ignores opt-in, not stored in history.
- Sending is claimed atomically (`scheduled → sending`), so the cron and a click can't send twice.
  A campaign stuck in `sending` for 15 min is marked `failed` (never re-sent, part may have gone out).

### Tickets and receipts

Every Expo ticket is stored in `push_tickets`. The cron fetches receipts for tickets older than
15 min (batches of 1000), marks them `delivered` / `error`, and recounts the campaign's
`deliveredCount` / `errorCount`. Tickets without a receipt after 24 h become `expired`.
`DeviceNotRegistered` (on a ticket or a receipt) sets the device `active = false`.

## Database

Migration **`lib/db/migrations/0018_push_campaigns.sql`** (not applied yet). The drizzle journal
is out of sync with production, so do **not** run `npm run db:migrate`; apply the SQL directly
(Supabase SQL editor or `psql "$DATABASE_URL" -f lib/db/migrations/0018_push_campaigns.sql`).
It is idempotent (`IF NOT EXISTS`). It adds:

- `push_devices.promo_opt_in` (default `false`), `locale`, `app_version`;
- `push_campaigns` (title, body, image_url, data, audience, status, scheduled_at, sent_at,
  recipient/accepted/delivered/error counts, last_error, created_by);
- `push_tickets` (campaign_id, token, ticket_id, status, error, checked_at).

Existing device rows get `promo_opt_in = false`, so they receive no promo pushes until the app
re-registers with the user's consent.

## Environment variables (Vercel)

| name | required | purpose |
|------|----------|---------|
| `CRON_SECRET` | yes (already set) | auth for `/api/cron/push-campaigns` |
| `EXPO_ACCESS_TOKEN` | only with Expo «Enhanced push security» | `Authorization: Bearer` for the Expo API |

`FCM_SERVER_KEY` is no longer used.

## Cron

`vercel.json` → `/api/cron/push-campaigns` every 5 minutes (`*/5 * * * *`). Vercel **Hobby**
only allows daily crons; on Hobby use an external scheduler (e.g. cron-job.org) calling
`https://www.dumbospizza.de/api/cron/push-campaigns` with `Authorization: Bearer $CRON_SECRET`
and remove the entry from `vercel.json`. Without the cron, "send now" still works, but scheduled
campaigns are not sent and delivered counts stay pending.

Manual run:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://www.dumbospizza.de/api/cron/push-campaigns
```

## Tests

`lib/push/__tests__/push.test.ts`: register validation, deep links, opt-in filtering,
batching of 100 / 1000, receipt handling and dead tokens.
