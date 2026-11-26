# Konto löschen (Mobile App) — `POST /api/mobile/v1/account/delete`

App Store Review Guideline 5.1.1(v): wer in der App ein Konto anlegen kann, muss es dort auch löschen können.

## Welche Konten?

Die App registriert Kunden über **Supabase Auth** (`auth.users`) im Supabase-Projekt dieser Website.
Die Website selbst nutzt Supabase Auth nicht: ihre Kundenkonten liegen in `users` (Cookie `dp_customer`, `lib/customer-auth.ts`).
Es gibt keine Verknüpfung zwischen beiden. App-Bestellungen kommen als Gastbestellungen
(`orders.user = NULL`, `source = 'app'`, Kontakt aus dem Bestellformular). Treuepunkte gibt es nur für Website-Konten (`users.id`),
App-Konten haben also keine `loyalty_*`-Zeilen.

## Was passiert

| Daten | Aktion | Grund |
|---|---|---|
| `auth.users` (E-Mail, Passwort-Hash, `user_metadata` mit Name/Telefon), Identities, Sessions, Refresh Tokens | **gelöscht** (`auth.admin.deleteUser`, hard delete) | DSGVO Art. 17 |
| `push_devices` mit der bestätigten Konto-E-Mail oder dem Push-Token des Geräts | **gelöscht** | kein Aufbewahrungsgrund |
| abgeschlossene/stornierte App-Bestellungen (`source='app'`, gleiche bestätigte E-Mail) | **bleiben, werden anonymisiert**: Name → „Gelöschtes Konto“, Telefon, E-Mail, Straße/Hausnummer, Notizen, Geo-Daten (`eta_analysis`), SMS-Einwilligung entfernt; PLZ/Ort, Positionen, Beträge, Zahlung, Bestellnummer, Datum bleiben | Buchungsbelege: 10 Jahre (§ 147 AO, § 257 HGB), DSGVO Art. 17 Abs. 3 lit. b |
| laufende App-Bestellung (`pending_payment`, `new`, `preparing`, `ready_for_delivery`, `delivering`) | Löschung wird mit **409** abgelehnt | Küche/Fahrer brauchen Kontakt bis zur Übergabe |
| `payments` / `refunds` (Zahlungsanbieter-Referenzen) | bleiben | Buchhaltung, Rückerstattungen; enthalten keine Kontodaten der App |
| `email_unsubscribes` | bleibt | Sperrliste: nötig, damit keine Werbung mehr geht |

Bestellungen werden nur über eine **bestätigte** E-Mail (`email_confirmed_at`) zugeordnet. Sonst könnte jemand mit fremder,
unbestätigter Adresse fremde Bestellungen anonymisieren.

Reihenfolge: erst DB (anonymisieren, Geräte), dann Auth-User. Fällt die DB aus, bleibt das Konto bestehen und die App kann mit
demselben Token erneut versuchen. Alle Schritte sind idempotent.

## Vertrag

```
POST /api/mobile/v1/account/delete
Authorization: Bearer <Supabase access_token der App-Session>
Content-Type: application/json

{ "confirm": true, "pushToken": "ExponentPushToken[…]" }   // pushToken optional
```

- `200 { success: true, anonymizedOrders, deletedPushDevices }`
- `400` ohne `confirm: true`, `401` ohne/mit ungültigem Token, `409` laufende Bestellung,
  `429` mehr als 5 Versuche pro IP in 10 Minuten, `500` generisch (Details nur im Server-Log).
  Fehler: `{ success: false, error: "<deutscher Text für den Kunden>" }`.

Code: `lib/account/app-account-deletion.ts` (Logik), `lib/account/app-account-deletion-deps.ts` (Supabase/Drizzle),
`lib/account/account-delete-handler.ts` (HTTP), Tests in `lib/account/__tests__/`.

## Deploy

Keine Migration nötig (nur vorhandene Spalten). In Vercel müssen gesetzt sein (sind es für Storage bereits):
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (nur Server), `DATABASE_URL`.
Der Service-Role-Key gehört nie in die App.

Prüfen nach Deploy (ohne echtes Konto zu löschen): `curl -X POST …/api/mobile/v1/account/delete -d '{"confirm":true}' -H 'content-type: application/json'` → `401`.
