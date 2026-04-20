# scripts

## `ap-import-flow.ts`

CLI che crea + importa + pubblica un flow Activepieces da un JSON
versionato, usando l'operazione nativa `FlowOperationType.IMPORT_FLOW`
(endpoint `POST /v1/flows/:id`). Stesso formato `Template` che l'UI
"Import flow" accetta nel frontend.

### Requisiti

- `dev-start.sh` attivo (AP backend/worker/frontend + MCP gateway + bridge Claude)
- `npx` / `tsx` (già nelle deps del repo)
- Un AI provider `custom` e almeno un MCP gateway già configurati (il
  test e2e lo fa in automatico — vedi `packages/tests-e2e/fixtures/`).

### Uso rapido

```bash
cd activepieces-fork

E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 \
  npx tsx scripts/ap-import-flow.ts \
    --template fixtures/flow-templates/estinzione.json \
    --name "Estinzione CLI demo" \
    --publish
```

Output (esempio):

```
[ap-import-flow] template: .../fixtures/flow-templates/estinzione.json
[ap-import-flow] api:      http://localhost:4200/api
[ap-import-flow] signed in, projectId=j0O1YmgW8yI2sP5M88sd0
[ap-import-flow] mcpGatewayId: MCPGW_abc123
[ap-import-flow] @activepieces/piece-webhook version: 0.1.32
[ap-import-flow] created flow XYZ
[ap-import-flow] imported graph
[ap-import-flow] published

{
  "flowId": "XYZ",
  "displayName": "Estinzione CLI demo",
  "published": true,
  "webhookUrl":     "http://localhost:4200/api/v1/webhooks/XYZ",
  "webhookSyncUrl": "http://localhost:4200/api/v1/webhooks/XYZ/sync",
  "resumeUrl":      "http://localhost:4200/api/v1/flow-runs/<runId>/requests/interactive_flow"
}
```

### Opzioni

| Flag | Default | Scopo |
|---|---|---|
| `-t, --template <path>` | — (required) | File JSON `Template` di AP |
| `-n, --name <string>` | `flows[0].displayName` | Override nome visualizzato |
| `-p, --publish` | off | `LOCK_AND_PUBLISH` dopo l'import (altrimenti draft) |
| `--mcp-gateway <name>` | primo disponibile | Risolve `__AUTO_MCP_GATEWAY__` |
| `--provider <name>` | `custom` | Nome provider AI (riservato a evoluzioni future) |
| `--api <url>` | `http://localhost:4200/api` | Base URL API di AP |
| `--email <email>` | `$E2E_EMAIL` o `dev@ap.com` | Credenziali sign-in |
| `--password <pw>` | `$E2E_PASSWORD` o `12345678` | Credenziali sign-in |

### Placeholder risolti a runtime

I template JSON sono pensati per essere **portabili** tra installazioni.
Per questo contengono placeholder al posto di ID platform-specific.
Lo script li sostituisce al momento della creazione del flow:

| Placeholder | Risolto via |
|---|---|
| `__AUTO_MCP_GATEWAY__` | `GET /v1/mcp-gateways` — match per nome (`--mcp-gateway`) o primo disponibile |
| `__AUTO_PIECE_VERSION__` | `GET /v1/pieces/<pieceName>` — versione corrente |

### Formato del template

Il JSON segue lo schema `Template` di
`packages/shared/src/lib/management/template/template.ts`:

```json
{
  "name": "…",
  "description": "…",
  "type": "FLOW",
  "flows": [
    {
      "displayName": "…",
      "schemaVersion": "20",
      "trigger": {
        "name": "trigger",
        "type": "PIECE_TRIGGER",
        "settings": { "pieceName": "…", "pieceVersion": "__AUTO_PIECE_VERSION__", … },
        "nextAction": { "type": "INTERACTIVE_FLOW", "settings": {…}, … }
      }
    }
  ]
}
```

### Triggerare il flow creato

Una volta ottenuto `webhookUrl`:

```bash
curl -X POST "$WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -d '{"message": "Vorrei estinguere un rapporto di Bellafronte"}'
```

E per ogni risposta successiva del cliente, usa il `resumeUrl`:

```bash
curl -X POST "http://localhost:4200/api/v1/flow-runs/<runId>/requests/interactive_flow" \
  -H 'content-type: application/json' \
  -d '{"message": "seleziono il cliente con NDG 11255521"}'
```

### Template inclusi

| Path | Scenario |
|---|---|
| `fixtures/flow-templates/estinzione.json` | Estinzione rapporto bancario (10 nodes, tool banking-* via MCP, dynamic messages via question-generator) |
