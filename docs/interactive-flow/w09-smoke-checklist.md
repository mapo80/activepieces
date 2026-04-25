# W-09 Smoke Verify Checklist

Status: BLOCKED on environment (requires staging stack with bridge +
fixture loaded). Procedure documented for on-call execution.

## Pre-conditions

- [ ] `claude-code-openai-bridge` running on port 8787
      (`curl -sf http://localhost:8787/health` → exit 0)
- [ ] `dev-start.sh` ready to launch 4 processes (api, worker, frontend,
      dev-tooling) with `AP_LLM_VIA_BRIDGE=true`
- [ ] Fixture `consultazione-cliente.json` importable via admin UI

## Procedure (8 evidences)

1. **Bridge health**
   `curl -sf http://localhost:8787/health` → exit 0, body contains `"ok"`

2. **Lint clean**
   `npm run lint-dev` → exit 0

3. **Engine tests green**
   `cd packages/server/engine && npm run test` → all pass

4. **Stack up**
   `AP_LLM_VIA_BRIDGE=true ./dev-start.sh` → 4 processes visible in
   `ps -ef | grep -E "(api|worker|frontend|dev-tooling)"`; readiness via
   `curl -sf http://localhost:3000/v1/health` and
   `curl -sf http://localhost:4200`

5. **Fixture import**
   Import `consultazione-cliente.json` via admin UI → fixture appears
   in flow list; verify via API
   `curl -s 'http://localhost:3000/v1/flows?projectId=<projectId>' \
    -H "Authorization: Bearer <token>"`.

6. **Send message**
   Open chat for the imported flow, send `"Bellafronte"`.

7. **Within 5s assert**:
   - DB turn log:
     ```sql
     SELECT status FROM "interactive_flow_turn_log"
     ORDER BY "createdAt" DESC LIMIT 1
     ```
     → first `'prepared'`, then `'finalized'`.
   - DB outbox count:
     ```sql
     SELECT COUNT(*) FROM "interactive_flow_outbox"
     WHERE "eventStatus" IN ('publishable','published')
     ```
     → ≥ 1.
   - WebSocket frame: DevTools Network → WS shows
     `INTERACTIVE_FLOW_TURN_EVENT` payload.
   - UI timeline shows `"📝 Estratto: customerName = Bellafronte"`
     (or localized equivalent post-H-04).
   - Bot message contains the bifase `preDagAck` + status combination
     rendered by `statusRenderer.combine`.

8. **Legacy regression**
   Re-run with fixture `useCommandLayer: false` → behavior unchanged
   (legacy field-extractor path).

## Logging

After execution, append to
[progress-log.md](progress-log.md) a dated block:

```markdown
## YYYY-MM-DD HH:MM UTC — W-09 smoke evidence

- commit: <hash>
- evidence 1 (bridge /health 200): <output snippet>
- evidence 2 (lint exit 0): <log snippet>
- evidence 3 (engine tests N/N): <log snippet>
- evidence 4 (4 processes up): <ps -ef snippet>
- evidence 5 (fixture imported): <flow id>
- evidence 6+7 (turn-log status, outbox count, WS frame, UI label,
  bot bifase): <DB rows + screenshot refs>
- evidence 8 (legacy regression unchanged): <comparison>
```

## Mock-bridge fallback (if bridge auth fails)

If the real bridge cannot be brought up due to credentials (Anthropic
API key absent in env), use the mock at
[packages/server/api/test/helpers/mock-llm-bridge.ts](../../packages/server/api/test/helpers/mock-llm-bridge.ts)
which serves canned `chat/completions` responses sufficient for the
estinzione + consultazione flows. Start with:

```bash
node packages/server/api/test/helpers/mock-llm-bridge.ts
```

Then run dev-start.sh as usual; the mock answers on
`http://localhost:8787/v1/chat/completions` with deterministic
SET_FIELDS commands matching the smoke fixtures.
