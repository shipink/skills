---
name: shipink-api
description: Use when writing, reviewing or debugging code that calls the Shipink REST API (api.shipink.io / api.dev.shipink.io) - creating orders, calculating shipping rates, creating or cancelling shipments and labels, cash-on-delivery, tracking, warehouses, carrier accounts or cards - or when the user mentions Shipink, a Shipink token, or Turkish cargo integrations (Aras, Yurtiçi, HepsiJET, Sendeo, PTT, MNG/DHL) through Shipink.
---

# Shipink API

Shipink is a shipping platform for Turkish e-commerce: one REST API for orders, rates, labels and tracking across many carriers.

## Sources of truth

- **OpenAPI spec (authoritative for fields and schemas):** https://docs.shipink.io/openapi.yaml. Fetch it before you write request bodies. Do not guess field names.
- Docs index for agents: https://docs.shipink.io/llms.txt. Full text: https://docs.shipink.io/llms-full.txt
- Human docs: https://docs.shipink.io/api

This skill holds what the spec does not make obvious. For flows read `references/flows.md`, for errors and retries read `references/errors.md`, for a client to copy see `examples/client.ts`.

## Environments

| | API base | Sign up |
|---|---|---|
| Test | `https://api.dev.shipink.io` | https://app.dev.shipink.io/signup |
| Production | `https://api.shipink.io` | https://app.shipink.io/signup |

Build against **test** first. Real cards do not work there; use Craftgate test cards (e.g. `5200170000000008`). Keep the base URL in config, never hard-coded.

## Auth

- `POST /token` with `{"username", "password"}` (the Shipink panel login) → `access_token`, `refresh_token`, `expires_in` (seconds, 3600 in examples).
- Send `Authorization: Bearer {access_token}` on every other call.
- Refresh with `POST /token` `{"refresh_token"}` before expiry, or on a `401`. `/token` errors are OAuth-style (`{"error": "invalid_grant", ...}`), not the usual envelope. Cache the token; do not log in on every request.
- Credentials come from env/secret storage. Never commit them or put them in a frontend bundle: the token can buy labels.
- The `/rates` docs mention an `X-User` header. The gateway fills it from the token, so a client does not need to send it.

## Core flow

```
POST /token → (GET /warehouses, once) → POST /orders → POST /rates → POST /shipments → label PDF → GET /trackings/{tracking_number}
```

1. **Warehouse** = sender address. `GET /warehouses` and reuse its `id`. Create one with `POST /warehouses` only if none exists.
2. **Order** first: `POST /orders` (`customer`, `items`, `currency`, `price` required). Keep the returned `id`.
3. **Rates**: `POST /rates` with `warehouse_id`, `recipient` (an **array** with one address), `packages`, optional `payment_type`. Each rate gives the `carrier_service.id` and `carrier_account_id` to pass on.
4. **Shipment**: `POST /shipments` with `order_id`, `carrier_service_id`, `carrier_account_id`, `warehouse_id`, `packages`, plus `card_id` when the rate's `provider` is `shipink`.
5. **Label**: `document.labels[].pdf|png|zpl`. The link 404s until `process` is `ready`.
6. **Tracking**: `GET /trackings/{tracking_number}` or `tracking.url` on the shipment.

## Things that bite

- **Shipment creation is slow and not idempotent.** It waits for the carrier for up to 45 s, so set the client timeout to at least 50 s. A retry after a client-side timeout can create a **second label and a second charge**. Before retrying, look the shipment up (`GET /shipments`, match `order_id`). Retry blindly only on `503 CARRIER_UNAVAILABLE` and `504 SHIPMENT_CARRIER_REQUEST_TIMEOUT`: on those, no shipment exists and any charge was reverted.
- **Two kinds of carrier accounts** (`provider` on a rate):
  - `shipink`: Shipink's agreement. It is charged to the balance/card, so `card_id` is required (`GET /cards`, pick `default: true`). `charge` / `charge_try` is the amount actually debited, VAT included on domestic routes.
  - `user`: the customer's own carrier contract. No `card_id`, no Shipink charge.
- **Prices exclude VAT.** `carrier_service.price` excludes VAT. For what the customer pays Shipink, show `charge_try ?? charge`.
- **A rate price of `0` means "no price for this route", not free.** Sort it last or hide it.
- **`delivery_time` is in hours.**
- **Cash on delivery:** add `payment: {type: "CODCash" | "CODCredit", amount, currency}`. Only some services support it: pass `payment_type` to `/rates` to filter, or check `carrier_services[].payment_type.cod_cash|cod_credit` on `GET /carrier-accounts`. Leave `payment` out for a normal sender-paid shipment.
- **Returns:** `direction: "incoming"`. A return code nobody hands a parcel in for within 7 days is cancelled automatically.
- **Cancel** = `DELETE /shipments/{id}`.
- **Addresses** need `street, city, state, zip, country_code` (ISO-2). Use Turkish province and district names as written (`İstanbul`, `Maltepe`). Include the country code in phone numbers (`905321234567`).
- **Packages:** `weight` + `weight_unit` are required. Send `height/length/width` + `dimension_unit` too: desi (volumetric weight) usually decides the price, and wrong dimensions are billed later as a weight difference.
- **Label language:** `X-Language: tr|en` header on `POST /shipments`.
- **Lists** are paginated with `page` (from 1) and `limit` (max 100). `meta.total` is the count.

## Response envelope

```json
{ "success": true, "meta": { "status": 200, "message": "...", "total": 42 }, "data": ... }
```

Responses come wrapped in this envelope with the resource in `data`, even where the spec shows a bare object (`Order`, `Shipment`). Treat a request as failed when the HTTP status is not 2xx **or** `success` is `false`. Gateway errors (401, 502) can return a non-JSON body, so parse defensively. On errors, branch on `meta.code` (stable). Do **not** branch on `meta.message`: it is localized. See `references/errors.md`.

## When writing an integration

1. Fetch `openapi.yaml` and generate or check types from it.
2. Write a small client: base URL from config, token cache + refresh, a 50 s timeout for `POST /shipments`, a typed error that carries `meta.code`.
3. Persist the Shipink `order_id` and `shipment.id` next to your own order, so retries and webhooks can find them.
4. Exercise the whole flow against the test environment before switching the base URL.
