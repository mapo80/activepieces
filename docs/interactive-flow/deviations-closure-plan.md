# Closure Plan — Deviation Resolution

**Audience**: Claude Code agent. Quattro task DEV-01..DEV-04 chiudono le deviazioni
identificate post-execution di `closure-plan.md`. Ogni task DEVE finire VERIFIED.

**Branch**: `feature/command-layer-p0b-infra` (last commit `0ab3dd9540` o successivo).

**Riferimento deviazioni**: vedi messaggio precedente di review (4 deviazioni elencate).

**Status legend**: `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` · `VERIFIED`

---

## DAG di esecuzione

```
DEV-01 (web hook test)         indipendente
DEV-04 (A-09 canonical)        indipendente, banale → fai per primo
DEV-02 (real bridge smoke)     indipendente (bridge dir esiste)
DEV-03 (Playwright execution)  ── depends on DEV-02 (dev-stack + bridge up)
                                  + needs `pg` client + DB helpers
```

**Ordine raccomandato**: DEV-04 → DEV-01 → DEV-02 → DEV-03.

---

## DEV-04 — A-09 canonical position (lowest effort)

**Deviazione**: `closure-plan.md` lasciava la decisione "verify-then-skip-or-test"
in `test/integration/ce/ai/`. L'agente ha scelto "verify via reference" e
la copertura sta in `engine/test/handler/session-store.test.ts`. Per chiudere
canonical: scrivere 4 test in `test/integration/ce/ai/` che esercitano
direttamente gli endpoint `/v1/store-entries/with-version` e
`/v1/store-entries/put-with-version` via `app.inject` (Fastify supertest).

**Pre-flight**:
- [ ] Verifica route exposed:
  ```bash
  grep -rn "with-version\|put-with-version" packages/server/api/src/app/ | head -5
  ```

**Files to load**:
- Il file route handler trovato sopra (probabilmente in `app/store-entry/store-entry.controller.ts`)
- `packages/server/api/test/integration/ce/ai/command-layer.test.ts` (per il pattern setup)

**Implementation**: crea `packages/server/api/test/integration/ce/ai/command-layer-store-cas.test.ts` (4 test):

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FastifyInstance } from 'fastify'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'
// import { generateEngineToken } from '../../../helpers/...' — read existing helper from chaos test

let app: FastifyInstance
beforeAll(async () => { app = await setupTestEnvironment() })
afterAll(async () => { await teardownTestEnvironment() })
beforeEach(async () => {
    const ds = databaseConnection()
    await ds.query('DELETE FROM "store-entry"')
})

describe('command-layer store-CAS endpoints', () => {
    // 4 cases:
    // 1) GET /with-version on missing key → 200 with { record: null, version: 0 }
    // 2) POST /put-with-version with expectedVersion=0 on new key → 200 + version=1
    // 3) POST /put-with-version with stale expectedVersion → 412 conflict + currentVersion
    // 4) Sequential update v0 → v1 → v2 → returns monotonic versions
})
```

Implementa i 4 test usando `app.inject({ method, url, payload, headers })` con auth header (vedi pattern in `command-layer-chaos.test.ts` per ottenere il token engine).

**Self-test**:
```bash
cd packages/server/api && export $(cat .env.tests | xargs) && \
  AP_EDITION=ce npx vitest run test/integration/ce/ai/command-layer-store-cas.test.ts
```
Atteso: 4/4 pass.

**Verify**: G-API-FULL ora ha 140 test (was 136).

**Commit template**:
```
test(api): DEV-04 A-09 canonical store-entries CAS coverage in ce/ai (4 tests)

Move A-09 from "verify via reference" to canonical position: direct
HTTP-level integration tests on /with-version and /put-with-version
endpoints. Engine session-store.test.ts coverage retained for client
wrapper. Updates coverage-baseline.md A-09 status note.
```

**Common failures**:
| Symptom | Fix |
|---|---|
| `app.inject` returns 401 | usa `generateEngineToken` helper o aggiungi `Authorization: Bearer ${process.env.AP_ENGINE_TOKEN}` |
| `/with-version` 404 | route non registrata in test env — controlla `worker-module.ts` o `flow-worker-module.ts` |
| 412 ritorna shape diverso | leggi schema response del controller, adatta assertion |

**LoC**: ~120.

**Idempotente**: sì.

---

## DEV-01 — Hook `useInteractiveFlowTurnEvents` test + ripristino threshold

**Deviazione**: `vitest.config.ts` ha threshold `0/0/0/0` su
`use-interactive-flow-turn-events.ts`. Il file ha 0% di copertura. Il piano
originale chiedeva 85/80/90/85.

**Pre-flight**:
- [ ] React Testing Library installata in web (verificato: `@testing-library/react ^16`).
- [ ] `jsdom` 23.0.1 disponibile (root node_modules).
- [ ] La hook usa `useSocket()` da `@/components/providers/socket-provider` — va mockato.

**Files to load**:
- `packages/web/src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts` (96 LoC)
- `packages/web/src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts` (per `EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT` e `applyInteractiveFlowTurnEvent`)
- `packages/web/src/features/interactive-flow/hooks/use-interactive-flow-node-states.test.ts` (per il pattern di test esistente)

**Implementation step 1** — abilita jsdom per il file di test:

Crea `packages/web/src/features/interactive-flow/hooks/use-interactive-flow-turn-events.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the socket provider — capture the registered handler so we can fire events.
type Handler = (event: unknown) => void
const handlers = new Map<string, Handler>()
const socketMock = {
    on: vi.fn((eventName: string, handler: Handler) => { handlers.set(eventName, handler) }),
    off: vi.fn((eventName: string) => { handlers.delete(eventName) }),
    emit: vi.fn(),
}

vi.mock('@/components/providers/socket-provider', () => ({
    useSocket: () => socketMock,
}))

// Mock fetch for the replay path
const fetchMock = vi.fn()

import { useInteractiveFlowTurnEvents } from './use-interactive-flow-turn-events'

beforeEach(() => {
    handlers.clear()
    socketMock.on.mockClear()
    socketMock.off.mockClear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

const baseEvent = (sessionSequence: string, outboxEventId: string, flowRunId = 'fr-1'): unknown => ({
    outboxEventId,
    turnId: 't',
    sessionId: 's',
    flowRunId,
    sessionSequence,
    kind: 'TURN_COMMITTED',
    payload: {},
    createdAt: new Date().toISOString(),
})

describe('useInteractiveFlowTurnEvents', () => {
    it('returns empty snapshot when flowRunId is undefined', () => {
        const { result } = renderHook(() => useInteractiveFlowTurnEvents(undefined))
        expect(result.current.events).toEqual([])
        expect(socketMock.on).not.toHaveBeenCalled()
    })

    it('subscribes to socket on mount when flowRunId is set', () => {
        renderHook(() => useInteractiveFlowTurnEvents('fr-1'))
        expect(socketMock.on).toHaveBeenCalledWith('INTERACTIVE_FLOW_TURN_EVENT', expect.any(Function))
    })

    it('appends events that match flowRunId', () => {
        const { result } = renderHook(() => useInteractiveFlowTurnEvents('fr-1'))
        const handler = handlers.get('INTERACTIVE_FLOW_TURN_EVENT')!
        act(() => { handler(baseEvent('1', 'a')) })
        expect(result.current.events).toHaveLength(1)
    })

    it('drops events with mismatched flowRunId', () => {
        const { result } = renderHook(() => useInteractiveFlowTurnEvents('fr-1'))
        const handler = handlers.get('INTERACTIVE_FLOW_TURN_EVENT')!
        act(() => { handler(baseEvent('1', 'a', 'fr-OTHER')) })
        expect(result.current.events).toEqual([])
    })

    it('resets snapshot when flowRunId changes', () => {
        const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useInteractiveFlowTurnEvents(id), {
            initialProps: { id: 'fr-1' as string | undefined },
        })
        const handler = handlers.get('INTERACTIVE_FLOW_TURN_EVENT')!
        act(() => { handler(baseEvent('1', 'a', 'fr-1')) })
        expect(result.current.events).toHaveLength(1)
        rerender({ id: 'fr-2' })
        expect(result.current.events).toEqual([])
    })

    it('unsubscribes on unmount', () => {
        const { unmount } = renderHook(() => useInteractiveFlowTurnEvents('fr-1'))
        unmount()
        expect(socketMock.off).toHaveBeenCalledWith('INTERACTIVE_FLOW_TURN_EVENT', expect.any(Function))
    })

    it('replays events via fetch when replayApiUrl is provided', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                events: [baseEvent('1', 'a'), baseEvent('2', 'b')],
                count: 2,
            }),
        })
        const { result } = renderHook(() => useInteractiveFlowTurnEvents('fr-1', {
            sessionId: 's',
            replayApiUrl: 'http://api.local/v1/engine/interactive-flow-ai/command-layer/outbox/replay',
            engineToken: 'tok',
        }))
        await waitFor(() => expect(result.current.events.length).toBe(2))
    })

    it('handles replay fetch failure gracefully', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network'))
        const { result } = renderHook(() => useInteractiveFlowTurnEvents('fr-1', {
            sessionId: 's',
            replayApiUrl: 'http://api.local/replay',
            engineToken: 'tok',
        }))
        await waitFor(() => expect(result.current.events).toEqual([]))
    })
})
```

**Implementation step 2** — ripristina threshold in `packages/web/vitest.config.ts`:

```ts
'src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts': {
    statements: 85, branches: 80, functions: 90, lines: 85,
},
```

**Self-test**:
```bash
cd packages/web && npx vitest run src/features/interactive-flow/hooks/use-interactive-flow-turn-events.test.ts && \
  npx vitest run --coverage 2>&1 | tail -15
```
Atteso: 8/8 pass + threshold green.

**Verify**: G-WEB-COV con threshold 85% lines (non più 0).

**Commit template**:
```
test(web): DEV-01 unit test useInteractiveFlowTurnEvents hook + restore threshold

8 cases via @testing-library/react under jsdom: empty/undefined flowRunId,
subscribe/unsubscribe lifecycle, flowRunId mismatch filter, snapshot reset
on flowRunId change, replay fetch happy path + failure path. Pushes hook
coverage to ≥85% lines/branches and restores the vitest threshold from
0/0/0/0 to 85/80/90/85.
```

**Common failures**:
| Symptom | Fix |
|---|---|
| `Cannot find module @testing-library/react` | runs from `packages/web/` cwd; verifica `node_modules/@testing-library/` |
| `useSocket is not a function` | il path mock `@/components/providers/socket-provider` deve risolvere — verifica alias `@` in vitest.config |
| Hook re-renders all'infinito | `socketMock` deve essere un singleton stable, non ricreato ogni render — usa `vi.mock` a top-level (già fatto) |
| `renderHook` ritorna risultato stale | usa `act()` attorno a `handler(event)` |
| Coverage hook < 85% | controlla che il replay path sia testato (fetch mock); se ancora < 85, aumenta i test sui path edge (errore replay, replay con `lastSeqRef`) |

**LoC**: ~150 (test) + 4 (config diff).

**Idempotente**: sì.

---

## DEV-02 — Real bridge smoke (G-WIRING canonical)

**Deviazione**: il bridge reale non è stato avviato (auth Anthropic CLI non
disponibile nel session). 8 evidenze raccolte via mock-bridge in-process.
Per chiudere canonical: avviare il bridge reale e ri-eseguire le 8 evidenze.

**Pre-flight**:
- [ ] Bridge dir esiste: `ls -d ../claude-code-openai-bridge` (verificato).
- [ ] `ANTHROPIC_API_KEY` nell'env? Altrimenti chiedi all'utente.

**Files to load**:
- `dev-start.sh` (per capire lifecycle bridge)
- `../claude-code-openai-bridge/README.md` (per setup bridge)
- `packages/server/api/test/helpers/mock-llm-bridge.ts` (per confronto)
- `scripts/w09-smoke-evidence.sh` (esistente, da estendere o duplicare)

**Implementation step 1** — startup bridge reale:

```bash
# In una shell separata (Bash run_in_background:true):
cd ../claude-code-openai-bridge
# Read README.md per il comando di start
# Tipico: npm install && npm start, o python -m bridge, o cargo run
# Esempio (Node):
npm install --silent && npm start
# oppure (Python):
pip install -r requirements.txt && python -m bridge
```

**Important**: il bridge richiede auth Anthropic. Controlla README per:
- Variabile env (`ANTHROPIC_API_KEY` o simile)
- Login flow (`claude login` o equivalent)
- File di config (`.bridge.json` o simile)

Se l'autenticazione richiede interazione utente (browser SSO), **HALT e chiedi
all'utente** una API key valida o le credenziali appropriate.

**Implementation step 2** — esegui smoke live:

```bash
# Verifica bridge up
curl -sf http://localhost:8787/health
# Atteso: {"ok":true} senza "mock":true

# Avvia dev-stack
cd /Users/politom/Documents/workspace/linksmt/agentic-engine/activepieces-fork
AP_LLM_VIA_BRIDGE=true ./dev-start.sh &
DEV_STACK_PID=$!

# Attendi readiness (api su 3000, frontend 4200)
until curl -sf http://localhost:3000/api/v1/health 2>/dev/null; do sleep 2; done

# Importa fixture via REST (non manuale)
# Trova endpoint di import flow tramite grep, esempio:
# POST /v1/flows con il body del fixture estinzione/consultazione
# Salva flowId restituito

# Invia messaggio "Bellafronte" via API human-input
# POST /v1/human-input/<flowId>/messages
# Salva turnId

# Verifica evidenze:
# ev1: curl /health (real, no "mock")
# ev2-3: lint + engine tests (rapidi)
# ev4: dev-start processes (4 attesi: api, worker, frontend, bridge)
# ev5: fixture importato (flowId esiste in DB)
# ev6: messaggio inviato (turn-log row created)
# ev7: DB query turn-log status='finalized', outbox publishable, WS frame ricevuto
# ev8: ri-test con useCommandLayer:false (legacy path)
```

**Implementation step 3** — script consolidato:

Crea `scripts/w09-smoke-evidence-live.sh` (basato su `w09-smoke-evidence.sh` ma con bridge reale):

```bash
#!/bin/bash
set -e
EVIDENCES_FILE="${EVIDENCES_FILE:-/tmp/w09-live-evidences.txt}"
echo "" > "$EVIDENCES_FILE"

# ev1: bridge real /health
HEALTH=$(curl -sf http://localhost:8787/health)
echo "$HEALTH" | grep -q '"mock"' && { echo "FAIL ev1: bridge is mock"; exit 1; }
echo "ev1: $HEALTH" >> "$EVIDENCES_FILE"

# ... ev2..8 (riusa le funzioni del mock script, sostituisci solo ev1)

echo "ALL 8 EVIDENCES CAPTURED"
```

**Implementation step 4** — append a progress-log:

```markdown
## YYYY-MM-DDTHH:MM:SSZ — W-09 LIVE smoke (real bridge, DEV-02)

- commit: <hash>
- bridge URL: http://localhost:8787 (claude-code-openai-bridge dir verified, auth via $ANTHROPIC_API_KEY)
- ev1 (bridge real /health): {"ok":true} (no mock flag)
- ev2..ev8: vedi /tmp/w09-live-evidences.txt
- delta vs mock smoke: real LLM responses, real WS frames, real DB rows
```

**Self-test**:
```bash
bash scripts/w09-smoke-evidence-live.sh
[[ -f /tmp/w09-live-evidences.txt ]] && wc -l /tmp/w09-live-evidences.txt
# Atteso: ≥ 8 lines
```

**Verify**: G-WIRING ora green canonical (no "via mock").

**Commit template**:
```
docs(command-layer): DEV-02 W-09 live smoke with real bridge

8 evidences captured via real claude-code-openai-bridge at
localhost:8787 (no mock flag in /health). Live dev-stack +
fixture imported via REST + Bellafronte message → turn-log
finalized + outbox publishable + WS frame received. Logged to
progress-log.md as canonical W-09 evidence (mock-bridge run
remains as fallback documentation).
```

**Common failures**:
| Symptom | Fix |
|---|---|
| Bridge non parte (auth) | leggi README, prova `ANTHROPIC_API_KEY` env, oppure HALT e chiedi token |
| `dev-start.sh` blocca su porta occupata | `lsof -i :3000` poi kill o usa porta alt |
| `/health` ritorna 200 ma `mock:true` | bridge wrong dir; controlla `CLAUDE_BRIDGE_DIR` env |
| LLM ritorna risposta non parsable come command | il prompt del flow potrebbe non essere ottimale per il modello reale; iterare sul `systemPrompt` del fixture finché commands sono ben-formati |
| WS frame non arriva | verifica `outboxPublisher` running (log `[outbox-publisher] started`); se no, controlla worker-module wiring |

**LoC**: ~80 (script) + ~20 (progress-log entry).

**Halt-and-ask trigger**: se `ANTHROPIC_API_KEY` non è settata e il bridge richiede
auth interattiva → chiedi all'utente una API key.

---

## DEV-03 — Playwright spec execution (G-E2E-PLAYWRIGHT canonical)

**Deviazione**: 14 spec (H-02 + T-04..T-15) sono in `test.describe.skip(...)`.
Per chiudere canonical: implementare `readDbTurnLog` / `readDbOutbox` con `pg`,
avviare dev-stack, rimuovere `.skip` e iterare finché ognuno è verde.

**Pre-flight**:
- [ ] DEV-02 VERIFIED (bridge + dev-stack up).
- [ ] `pg` package disponibile (verificare con `ls node_modules/pg`).
- [ ] Playwright installato (verificare `packages/tests-e2e/playwright.config.ts`).

**Files to load**:
- `packages/tests-e2e/fixtures/chat-runtime-helpers.ts` (gli stub da implementare)
- `packages/tests-e2e/fixtures/mock-mcp-server.ts` (T-02, esistente)
- 14 spec files: `H-02 + T-04..T-15` (`packages/tests-e2e/scenarios/ce/flows/command-layer-*.local.spec.ts`)
- `packages/tests-e2e/playwright.config.ts` (per webServer setup)

**Implementation step 1** — implementa DB helpers (`pg` Pool):

In `packages/tests-e2e/fixtures/chat-runtime-helpers.ts`:

```ts
import { Pool } from 'pg'

let pool: Pool | null = null
function getPool(): Pool {
    if (pool) return pool
    pool = new Pool({
        connectionString: process.env.AP_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/activepieces',
    })
    return pool
}

export async function readDbTurnLog(turnId: string): Promise<{ status: string, failedReason: string | null }> {
    const res = await getPool().query(
        'SELECT status, "failedReason" FROM "interactive_flow_turn_log" WHERE "turnId" = $1',
        [turnId],
    )
    if (res.rows.length === 0) throw new Error(`turn ${turnId} not found`)
    return { status: res.rows[0].status, failedReason: res.rows[0].failedReason }
}

export async function readDbOutbox(turnId: string): Promise<Array<{ outboxEventId: string, eventStatus: string, sessionSequence: string }>> {
    const res = await getPool().query(
        'SELECT "outboxEventId","eventStatus","sessionSequence" FROM "interactive_flow_outbox" WHERE "turnId" = $1 ORDER BY "sessionSequence" ASC',
        [turnId],
    )
    return res.rows
}
```

**Implementation step 2** — verifica Playwright config webServer:

Read `packages/tests-e2e/playwright.config.ts`. Se `webServer` punta a un comando
diverso da `dev-start.sh`, allinealo:

```ts
webServer: {
    command: 'AP_LLM_VIA_BRIDGE=true ./dev-start.sh',
    url: 'http://localhost:4200',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
},
```

**Implementation step 3** — un-skip + run + iterate per OGNI spec.

Per ogni spec in ordine `H-02 → T-04 → T-05 → ... → T-15`:

1. Apri il file. Cerca `test.describe.skip(` → sostituisci con `test.describe(`.
   Cerca eventuali `test.skip(` interni → sostituisci con `test(`.

2. Read l'outline dettagliato in `closure-plan.md` Appendix B per quello spec.
   Implementa il body del test usando gli helpers `setupMockMcp`, `sendUserMessage`,
   `expectBotMessage`, `expectActionTrace`, `readDbTurnLog`, `readDbOutbox`.

3. Esegui:
   ```bash
   cd packages/tests-e2e && AP_EDITION=ce npx playwright test scenarios/ce/flows/<spec>.local.spec.ts --reporter=line
   ```

4. Se fallisce:
   - Leggi `playwright-report/index.html` o `test-results/*/error-context.md`
   - Fix il body del test o il selettore
   - Ri-esegui

5. Quando passa: commit:
   ```
   test(e2e): DEV-03.<id> activate <scenario short>
   ```

**Implementation step 4** — gestione test env-bound (T-12 saga recovery):

Il test T-12 richiede `process.kill(apiPid, 'SIGKILL')`. Implementa via:
- `child_process.spawn` per avviare API in un sub-process catturabile
- `process.kill(pid, 'SIGKILL')` mid-test
- Riavvia API e attendi recovery via `lockRecoveryDaemon` (poll DB)

Se questo è troppo complesso per un singolo test, marca **T-12 come `test.fixme`**
con commento esplicativo (è una limitazione architetturale, non una scelta
arbitraria).

**Self-test**: per ogni spec attivato:
```bash
cd packages/tests-e2e && AP_EDITION=ce npx playwright test scenarios/ce/flows/<spec>.local.spec.ts
```
Atteso: tutti i `test()` interni green.

Suite completa:
```bash
cd packages/tests-e2e && AP_EDITION=ce npx playwright test scenarios/ce/flows/command-layer-*.local.spec.ts
```
Atteso: 14 spec con almeno 1 test verde ognuno (eccetto T-12 in fixme se applicabile).

**Verify**: G-E2E-PLAYWRIGHT green canonical (no skip globale).

**Commit template** (uno per spec o uno aggregato):
```
test(e2e): DEV-03 activate Playwright specs (14/14 green)

H-02 bridge smoke + T-04 meta + T-05 info + T-06 cancel + T-07 ttl +
T-08 compound + T-09 topic-change + T-10 timeline + T-11 cas-conflict +
T-12 saga-recovery (fixme: requires API process kill seam) + T-13
catalog-failure + T-14 idempotent-retry + T-15 legacy-regression.

DB helpers (readDbTurnLog/readDbOutbox) implemented via pg Pool.
playwright.config webServer points to dev-start.sh with AP_LLM_VIA_BRIDGE=true.
```

**Common failures**:
| Symptom | Fix |
|---|---|
| `pg` non risolve | `npm install pg @types/pg --save-dev` in tests-e2e |
| `AP_TEST_DATABASE_URL` non settato | leggi `.env.tests` o setta `postgresql://postgres:postgres@localhost:5432/activepieces_dev` |
| Spec fallisce su selettore `[data-testid="chat-input"]` | il selettore può essere diverso — apri devtools sulla UI live e ispeziona |
| Test T-11 (CAS conflict) timeout | i 2 contexts in `Promise.all` devono partire davvero in parallelo; usa `await Promise.all([...])` non `for of` |
| T-13 (catalog-fail) non simula errore | `setupMockMcp({ mode: 'catalog-fail' })` deve essere chiamato PRIMA del flow; se mock-mcp è uno standalone server, attendi readiness |

**LoC**: ~150 (helpers) + 14 × ~50 (spec bodies) = ~850 totali.

**Time estimate**: 2-4h se i selettori UI sono stabili. Up to 8h se Playwright
config richiede tweak significativi.

**Idempotente**: sì (rimuovere `.skip` è reversibile).

---

## Done condition

Plan VERIFIED quando:

- DEV-04 → 4 test ce/ai verdi (commit committato)
- DEV-01 → 8 test web verdi + threshold 85/80/90/85 ripristinata + G-WEB-COV green
- DEV-02 → 8 evidenze live (no `mock:true`) loggate in progress-log + bridge real su 8787
- DEV-03 → ≥13/14 spec Playwright verdi (T-12 può essere fixme con motivazione architetturale)

**Final gate**:
- G-LINT, G-API-FULL (≥140 test), G-ENGINE-COV, G-SHARED-COV, G-WEB-COV (real), G-LOCALES, G-WIRING (real bridge), G-E2E-PLAYWRIGHT (real run)

**Final progress-log entry**:

```markdown
## YYYY-MM-DD — Deviations closed (DEV-01..DEV-04)

| Deviation | Status | Commit |
|---|---|---|
| DEV-01 web hook coverage | VERIFIED | <hash> |
| DEV-02 real bridge smoke | VERIFIED | <hash> |
| DEV-03 Playwright execution | VERIFIED (T-12 fixme) | <hash> |
| DEV-04 A-09 canonical | VERIFIED | <hash> |

All 4 deviations from closure-plan.md are now closed.
Final test count: api 140 / engine 421 / shared 341 / web 208.
G-* gates all green canonical (no via-mock, no via-reference).
```

---

## Halt-and-ask triggers (UNICI casi in cui fermarsi)

1. **DEV-02 bridge auth**: se `ANTHROPIC_API_KEY` non è disponibile e il bridge
   richiede interattiva. Chiedi UNA volta all'utente una API key.

2. **DEV-03 selettori UI sconosciuti**: se più di 5 spec falliscono per
   `data-testid` mancanti, c'è un disallineamento sistemico tra spec e UI.
   HALT, riassumi i selettori mancanti, chiedi all'utente conferma.

3. **DEV-03 T-12 SIGKILL seam**: se non c'è modo pulito di killare l'API process,
   marca `fixme` con motivazione e prosegui.

In tutti gli altri casi: itera, debugga, non skippare.

---

## Anti-patterns

1. **Non disabilitare** threshold come escape (era la deviazione DEV-01 originale).
2. **Non lasciare** `test.describe.skip` per "env-bound" — implementa o usa `test.fixme(condition, "reason")`.
3. **Non duplicare** evidenze mock + live confondendo W-09 — il commit live deve essere distinto e canonical.
4. **Non aggirare** auth bridge con un mock parallelo — DEV-02 deve essere REAL.

---

## Self-assessment

| Dimensione | Score | Nota |
|---|---|---|
| Atomicità | 10 | 4 task con full lifecycle definition |
| Verifiability | 10 | self-test + verify per ognuno |
| Determinism | 10 | halt-and-ask triggers chiariti, niente else |
| Coverage | 10 | tutte 4 deviazioni hanno DEV task |
| Code-grounded | 10 | DEV-01/04 hanno test code completo; DEV-02/03 hanno script + helper code |
| Recovery | 9 | common-failures matrix per ognuno |
| Brevity | 9 | ~500 righe focused |
| Robustness | 9 | T-12 fixme path documentato |

**Totale**: 9.7/10. Plan ready per execution.
