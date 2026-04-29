# Agentic module

E07 G3 — Activepieces server-side proxy that bridges the AP runtime engine to the
Java `agentic-workflow-platform` provider. The proxy is intentionally thin: every
request is forwarded to the Java side, which performs the full Tool Gateway
governance pipeline (allowlist, schema validation, PEP, idempotency, audit, cost)
before reaching the MCP server.

## Endpoints

### `POST /agentic/v1/tools/invoke`

Invoked by the `@platform/tool-gateway` piece's `tool-call` action.

Body:

```json
{
  "mcpGatewayId": "g-123",
  "toolRef": "banking-customers/search_customer",
  "version": "1.0",
  "payload": { "query": "Mario", "limit": 10 },
  "idempotencyKey": "run:run-1:step:fetch:1",
  "effect": "READ",
  "runContext": {
    "platformRunId": "plat-1",
    "capabilityId": "banking.demo",
    "tenantId": "tenant-A"
  }
}
```

Response:

```json
{
  "outcome": "SUCCESS",
  "outputs": { "results": [...] },
  "latencyMs": 142,
  "retries": 0
}
```

The proxy forwards to `${AP_AGENTIC_PROVIDER_URL}/agentic/v1/tools/invoke` with the
same body. If the Java side is down, returns `502 Bad Gateway` with
`{error: "agentic-provider-unavailable", message: "..."}`.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `AP_AGENTIC_PROVIDER_URL` | `http://localhost:8090` | URL of the Java `activepieces-runtime-provider` server |
| `AP_AGENTIC_PROVIDER_API_KEY` | (empty) | Bearer auth for the Java side; empty in dev, required in prod |

## Security

- Endpoints require `securityAccess.engine()` — only the AP runtime engine
  principal can call them (no operator UI access, no external callers).
- All outbound HTTP uses `safeHttp.axios` from `@activepieces/server-utils`
  (SSRF-safe). The Java side is on `localhost` in dev — production deployments
  must adjust `AP_SSRF_ALLOW_LIST` if the Java provider runs on a different
  network.
- Auth to Java side via Bearer API key (configured in
  `AP_AGENTIC_PROVIDER_API_KEY`).

## Related modules

- Pieces: `packages/pieces/community/platform-{chat,workflow,tool-gateway}`
- MCP gateway registry: `packages/server/api/src/app/mcp-gateway/`
- Java side: `agentic-workflow-platform/src/activepieces-runtime-provider/`
