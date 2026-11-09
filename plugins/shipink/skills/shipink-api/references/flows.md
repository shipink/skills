# Shipink API flows

Request bodies here are minimal. The full schemas are in https://docs.shipink.io/openapi.yaml.

## 1. Token

```http
POST /token
Content-Type: application/json

{ "username": "user@example.com", "password": "..." }
```

The response contains `access_token`, `refresh_token`, `expires_in` and `token_type: "Bearer"`. Refresh it like this:

```json
{ "refresh_token": "..." }
```

## 2. Sender address (warehouse)

`GET /warehouses` gives you the warehouse `id`. Store it in config. A one-off setup is enough for most integrations.

## 3. Order

```http
POST /orders
{
  "customer": {
    "name": "Ali Yılmaz",
    "email": { "main": "ali@example.com" },
    "phone": { "main": "905321234567" },
    "address": {
      "street": "Örnek Sokak No:1",
      "city": "Maltepe",
      "state": "İstanbul",
      "zip": "34857",
      "country_code": "TR"
    }
  },
  "items": [{ "name": "T-Shirt", "quantity": 2, "price": 299.90 }],
  "currency": "TRY",
  "price": 599.80,
  "payment": { "method": "credit-card", "status": "completed" }
}
```

Keep the returned `id` as `order_id`. For international shipments, add `hs_code` and `origin` to the items. Customs needs them.

## 4. Rates

```http
POST /rates
{
  "warehouse_id": "96bfcda0-...",
  "recipient": [{ "city": "Maltepe", "state": "İstanbul", "zip": "34857", "country_code": "TR" }],
  "packages": [{ "weight": 1, "weight_unit": "kg", "height": 10, "length": 20, "width": 15, "dimension_unit": "cm" }],
  "payment_type": ["Sender"]
}
```

`recipient` is an array. `data[]` is the list of rates. Pick one rate and carry these fields forward:

- `carrier_service.id` → `carrier_service_id`
- `carrier_account_id`
- `carrier_service.provider`. When it is `shipink` you also need a `card_id`.
- Skip rates with `price` 0, because there is no price for that route.
- `cheapest` and `fastest` flags are precomputed.

## 5. Shipment

```http
POST /shipments
X-Language: tr
{
  "direction": "outgoing",
  "order_id": "Nc220IyHvpV_",
  "carrier_service_id": "hepsijet_standart",
  "carrier_account_id": "4a2e8c1f-...",
  "warehouse_id": "96bfcda0-...",
  "card_id": "a1b2c3d4-...",
  "packages": [{ "weight": 1, "weight_unit": "kg", "height": 10, "length": 20, "width": 15, "dimension_unit": "cm" }]
}
```

- `card_id` comes from `GET /cards` (the card with `default: true`). Send it only for `provider: shipink` rates.
- For cash on delivery, add `"payment": { "type": "CODCash", "amount": 599.80, "currency": "TRY" }`.
- To attach an e-invoice, add `"sales_invoice": { "no": "...", "date": "...", "url": "..." }`.
- The call can take up to 45 s. See `errors.md` before you add retries.

From the response, store these fields:

- `id`, needed to cancel the shipment and look it up again
- `tracking.id` / `tracking.url`
- `document.labels[0].pdf` (also `png`, `zpl` for thermal printers). The link returns 404 until `process` is `ready`: poll `GET /shipments/{id}` or retry the download with a short backoff.
- `rate.estimated_price`. Later `rate.actual_price` arrives with the price the carrier measured, both excluding VAT.

## 6. Tracking

`GET /trackings/{tracking_number}` returns `status`, `carrier` and `events[]` (`status`, `description`, `location`, `timestamp`).

## Cancel and returns

- Cancel: `DELETE /shipments/{shipment_id}`.
- Return label: `POST /shipments` with `"direction": "incoming"`. If nobody hands in a parcel within 7 days, it is cancelled automatically and refunded on Shipink agreements.

## Lookups

| Need | Endpoint |
|---|---|
| Carriers in the system | `GET /carriers` |
| Services per carrier | `GET /carrier-services` |
| The customer's linked accounts + COD flags | `GET /carrier-accounts` |
| Payment cards | `GET /cards` |
| Saved recipients | `GET /addresses` |
