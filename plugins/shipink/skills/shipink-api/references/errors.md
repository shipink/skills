# Shipink API errors and retries

Error responses use the standard envelope:

```json
{
  "success": false,
  "meta": {
    "status": 400,
    "code": "INVALID_INPUT",
    "message": "There is some problem with the data you submitted.",
    "details": [{ "field": "name", "error": "cannot be blank" }]
  }
}
```

- Branch on `meta.code`, never on `meta.message`: the message is localized and may change.
- `meta.details[]` lists field errors. For carrier errors `field` is `carrier_error` and `error` holds the carrier's own message. Show that message to the user, because it usually says what to fix (address, phone, desi).
- A `401` from the gateway (missing or expired token) can come with an **empty body**.
- `POST /token` errors are OAuth-style, not the envelope. Wrong credentials return `401 {"error": "invalid_grant", "error_description": "Invalid user credentials"}`. An expired refresh token also gives `invalid_grant`: fall back to a full login.

## Documented codes

| HTTP | `meta.code` | Meaning | What to do |
|---|---|---|---|
| 400 | `INVALID_INPUT` | Body failed validation | Fix the fields in `details`. Do not retry unchanged. |
| 400 | `CREDENTIALS_INVALID` | One of the customer's own carrier accounts has bad credentials. The message names the carrier. | The customer updates the carrier account in the panel, then retry. |
| 401 | – | Missing or expired token | Refresh the token (`POST /token` with `refresh_token`) once, then retry. If the refresh also fails, log in again. |
| 404 | `NOT_FOUND` | No such resource | Do not retry. |
| 503 | `CARRIER_UNAVAILABLE` | Carrier unreachable | Safe to retry with backoff. No shipment was created and any charge was reverted. |
| 504 | `SHIPMENT_CARRIER_REQUEST_TIMEOUT` | Carrier did not answer within ~45 s | Safe to retry with backoff, same as 503. |

The spec documents only the codes above. Treat any other code as non-retryable unless the status is 503 or 504.

## Retrying `POST /shipments`

`POST /shipments` has no idempotency key. These are the cases:

1. You got `503` or `504` **with** a JSON body containing one of the codes above: retry.
2. **Your own** client timed out, or the connection dropped, so you have no response: the shipment **may exist**. List recent shipments (`GET /shipments?limit=20`) and look for your `order_id` before you retry. Otherwise you risk two labels and two charges.
3. Any `4xx`: fix the input. Do not loop.

Use a client timeout of at least 50 s on this call, so that case 2 stays rare.
