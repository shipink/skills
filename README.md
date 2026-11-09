# Shipink skills

Agent skill for building integrations with the [Shipink API](https://docs.shipink.io/api). It teaches a coding agent the order → rates → shipment → label → tracking flow, plus the pitfalls the OpenAPI spec does not spell out: retries on the non-idempotent `POST /shipments`, the two carrier account kinds, VAT, cash on delivery and the error codes.

## Claude Code

```
/plugin marketplace add shipink/skills
/plugin install shipink@shipink
```

## Claude.ai / Claude Desktop

Zip `plugins/shipink/skills/shipink-api/` and upload it under **Settings → Capabilities → Skills**.

## Other agents (Cursor, Codex, Copilot, …)

Copy `plugins/shipink/skills/shipink-api/` into the agent's skills folder, or point the agent at:

- https://docs.shipink.io/llms.txt (docs index)
- https://docs.shipink.io/llms-full.txt (all docs + OpenAPI spec)
- https://docs.shipink.io/openapi.yaml

## Contents

```
plugins/shipink/skills/shipink-api/
  SKILL.md              when to use + core flow + pitfalls
  references/flows.md   request examples per step
  references/errors.md  error codes and retry rules
  examples/client.ts    minimal TypeScript client (token cache, refresh, timeouts)
```
