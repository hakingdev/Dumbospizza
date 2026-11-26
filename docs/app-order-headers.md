# Mobile app → order channel headers

The site marks orders that come from our mobile app as `📲 App · iOS` /
`📲 App · Android` in the Telegram order card and as `App` on the POS device.

To get that, the app must send three headers with **every** `POST /api/orders`
request (best set once in the shared HTTP client):

| Header           | Value                     | Required |
|------------------|---------------------------|----------|
| `X-Client`       | `dumbos-app` (exactly)    | yes      |
| `X-App-Platform` | `ios` or `android`        | recommended |
| `X-App-Version`  | app version, e.g. `1.4.2` | recommended |

Rules on the server side (`lib/orders/order-client.ts`):

- Without `X-Client: dumbos-app` the order is stored as `website`.
- Unknown platforms and versions with unsafe characters are dropped
  (the order is still marked `App`, just without platform/version).
- Version: letters, digits and `. + _ -`, up to 32 characters.
- A `source` field in the JSON body is ignored; the channel only comes from headers.

Stored as `orders.source = 'app'` and `orders.client_info = { platform, version }`.
For money (revenue, loyalty, VAT invoices) app orders count exactly like website orders.
