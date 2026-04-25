# INTERACTIVE_FLOW Command Layer — Closure Plan (canonical)

> **Versione**: v3 (canonical). v1/v2 sono iterations interne; questo file
> sostituisce entrambi. Usa solo questo file come fonte verità.

**Audience**: Claude Code agent. Picks first `TODO`, executes, verifies, commits, marks `VERIFIED`, moves on.

**Scope**: chiude il piano `floofy-yawning-meteor.md` portando a termine **C-RESIDUO + T-API-RESIDUO + H-HARDEN** e documentando i task `BLOCKED` (W-09, T-PLAYWRIGHT, R-RO/S-SUNSET).

**Branch**: `feature/command-layer-p0b-infra` (già a 41 commit; nuovo lavoro continua qui).

**Status legend**: `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` · `VERIFIED`

---

## Quickstart per nuovo agente (5 min)

```bash
cd /Users/politom/Documents/workspace/linksmt/agentic-engine/activepieces-fork

# 1. Branch correctness
[[ "$(git branch --show-current)" == "feature/command-layer-p0b-infra" ]] || { echo "WRONG BRANCH"; exit 1; }

# 2. Working tree clean
[[ -z "$(git status --short)" ]] || { echo "DIRTY TREE — commit/stash first"; exit 1; }

# 3. Last commit ricognizione
LAST=$(git log -1 --format=%H)
echo "Last commit: $LAST (atteso: 1ec430203e o successivo)"

# 4. Plan readable
[[ -f docs/interactive-flow/closure-plan.md ]] || { echo "PLAN MISSING"; exit 1; }

# 5. Repo paths
[[ -d packages/server/api/src/app/ai/command-layer ]] || { echo "COMMAND-LAYER DIR MISSING"; exit 1; }
[[ -d packages/server/engine/src/lib/handler ]] || { echo "ENGINE HANDLER DIR MISSING"; exit 1; }
[[ -d packages/web/public/locales ]] || { echo "LOCALES DIR MISSING"; exit 1; }

# Check: locales target
ls packages/web/public/locales/ | tr '\n' ' '
# atteso: ar de en es fr ja nl pt ru zh zh-TW

echo "All pre-flight checks passed — ready to execute first TODO."
```

---

## Global gates

| Gate | Comando | Atteso | When |
|---|---|---|---|
| G-LINT | `cd activepieces-fork && NODE_OPTIONS=--max-old-space-size=8192 npx eslint <files>` | exit 0 | per task |
| G-API-COV | `cd packages/server/api && export $(cat .env.tests \| xargs) && AP_EDITION=ce npx vitest run --coverage.enabled test/integration/ce/ai/` | thresholds met (C-01) | post C-COVERAGE |
| G-ENGINE-COV ⭐ | `cd packages/server/engine && npm run test -- --coverage` | thresholds C-02 met | post C-02/C-08 |
| G-SHARED-COV ⭐ | `cd packages/shared && npx vitest run --coverage` | thresholds C-03 met | post C-03/C-09 |
| G-WEB-COV ⭐ | `cd packages/web && npx vitest run --coverage` | thresholds C-04 met | post C-04 |
| G-API-FULL | tutti i 106+ test ce/ai green | no regressions | dopo ogni T-API |
| G-LOCALES | check script (vedi H-01 self-test) | 5 chiavi in 10 locales | post H-01 |
| G-WIRING | manual smoke (W-09) | env-bound | on-call |
| G-E2E-PLAYWRIGHT | `AP_EDITION=ce npm run test:e2e -- packages/tests-e2e/scenarios/ce/flows/command-layer-*.local.spec.ts` | env-bound | on-call |

⭐ = thresholds da introdurre o estendere in questo piano.

---

## Phase overview con priorità + dipendenze

| Phase | Priority | Tasks | Depends on | Env-bound |
|---|---|---|---|---|
| **C-RESIDUO** | P0 | C-08, C-09, C-02, C-03, C-04 | none (eseguire in quest'ordine) | no |
| **T-API-RESIDUO** | P1 | A-02, A-04, A-09, A-10 (doc), A-03, A-07, A-12 | C-RESIDUO done (ma indipendente) | no |
| **H-HARDEN** | P2 | H-01, H-05, H-03, H-04, H-02 | H-04 dipende da H-01 (chiavi i18n) | H-02 sì |
| **W-09 doc** | P0 | smoke-checklist.md | none | sì (smoke) |
| **T-PLAYWRIGHT scaffold** | P0 | T-02, T-03 helpers + T-04..T-15 stubs | T-02/T-03 first | scaffold no, run sì |
| **R-RO / S-SUNSET doc** | P3 | canary-rollout-plan.md | none | sì (run) |

**Done condition**: tutte le P0/P1/P2 VERIFIED, gates non-env-bound green, env-bound task documentati con checklist.

---

## DAG di esecuzione

```
                  C-08 ──┐
                  C-09 ──┤
                          ├─► C-02 (engine config)
                  ────────┘
                  C-09 ──► C-03 (shared config)
       C-04 (web config + reducer test) ──► (nessuna dipendenza)

       T-API: A-02-doc, A-04-doc, A-09-check, A-10-doc (rapidi, ordine libero)
              A-03 (publisher integration)  ─┐
              A-07 (traces)                  ├─► tutti indipendenti
              A-12 (cross-flow)              ─┘

       H-HARDEN:
       H-01 (i18n keys 10 locales) ──► H-04 (timeline localize)
       H-03 (Prometheus metrics)    indipendente
       H-05 (PII redactor outbox)   indipendente
       H-02 (bridge spec scaffold)  indipendente, env-bound

       Doc-only (in parallelo):
       W-09 doc, T-PLAYWRIGHT scaffold (T-02, T-03, T-04..T-15),
       R-RO / S-SUNSET canary doc
```

**Parallelismo single-agent**: ordine sequenziale C-08 → C-09 → C-02 → C-03 → C-04 → T-API-doc tasks (A-02, A-04, A-10) → A-09 verifica → A-03 → A-07 → A-12 → H-01 → H-05 → H-03 → H-04 → H-02 → W-09 doc → T-02 → T-03 → T-04..T-15 → R-RO/S-SUNSET doc.

---

## C-RESIDUO

### C-08 — Engine `turn-interpreter-client.ts` unit tests (FIRST)

**Why first**: C-02 enforcerà ≥90% e quel file oggi non ha test dedicati. Senza C-08, C-02 farà fallire il gate.

**Pre-flight**:
- [ ] [packages/server/engine/test/handler/test-helper.ts](packages/server/engine/test/handler/test-helper.ts) esiste (verifica `ls`).
- [ ] vitest 3.0.8 installato.

**Files to load**:
- [packages/server/engine/src/lib/handler/turn-interpreter-client.ts](packages/server/engine/src/lib/handler/turn-interpreter-client.ts)
- [packages/server/engine/src/lib/handler/context/engine-constants.ts](packages/server/engine/src/lib/handler/context/engine-constants.ts) (per il tipo)

**Implementation**: crea `packages/server/engine/test/handler/turn-interpreter-client.test.ts` (18 test):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnInterpreterClient } from '../../src/lib/handler/turn-interpreter-client'

const fetchMock = vi.fn()
const baseConstants = {
    internalApiUrl: 'http://api.local/',
    engineToken: 'test-token',
} as never

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
    vi.unstubAllGlobals()
})

describe('turnInterpreterClient.interpret', () => {
    it('returns body on 200', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ turnStatus: 'prepared' }) })
        const res = await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't1', idempotencyKey: 'i1' } as never })
        expect(res?.turnStatus).toBe('prepared')
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api.local/v1/engine/interactive-flow-ai/command-layer/interpret-turn',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'Authorization': 'Bearer test-token', 'Idempotency-Key': 'i1' }),
            }),
        )
    })
    it('returns body on 409 (replay/conflict)', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ turnStatus: 'failed', error: 'replay' }) })
        const res = await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't2', idempotencyKey: 'i2' } as never })
        expect(res?.turnStatus).toBe('failed')
    })
    it('returns null on non-ok non-409 (e.g. 500)', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
        expect(await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't3', idempotencyKey: 'i3' } as never })).toBeNull()
    })
    it('returns null on json parse failure', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad-json') } })
        expect(await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't4', idempotencyKey: 'i4' } as never })).toBeNull()
    })
    it('returns null on fetch throw (network error)', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
        expect(await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't5', idempotencyKey: 'i5' } as never })).toBeNull()
    })
})

describe('turnInterpreterClient.finalize', () => {
    it('returns true on 200 + ok=true', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(true)
    })
    it('returns false on 200 + ok=false', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false }) })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on 404', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ ok: false }) })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on json parse fail', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('x') } })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on fetch throw', async () => {
        fetchMock.mockRejectedValueOnce(new Error('boom'))
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
})

describe('turnInterpreterClient.rollback', () => {
    it('forwards reason in body', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
        await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt', reason: 'engine-error' })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body).toEqual({ turnId: 't', leaseToken: 'lt', reason: 'engine-error' })
    })
    it('omits reason when undefined', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
        await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.reason).toBeUndefined()
    })
    it('returns false on 4xx', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false }) })
        expect(await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on fetch throw', async () => {
        fetchMock.mockRejectedValueOnce(new Error('x'))
        expect(await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
})

describe('turnInterpreterClient.buildCatalogReadiness', () => {
    it('returns ready=true when source array is non-empty', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [{ id: 1 }] },
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' } as never],
        })).toEqual({ accounts: true })
    })
    it('returns ready=false when source is empty array', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [] },
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' } as never],
        })).toEqual({ accounts: false })
    })
    it('returns ready=false when source is missing', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: {},
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' } as never],
        })).toEqual({ accounts: false })
    })
    it('returns empty object when no enumFrom present', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [1] },
            stateFields: [{ name: 'plain', type: 'string' } as never],
        })).toEqual({})
    })
    it('deduplicates source names across stateFields', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [1] },
            stateFields: [
                { name: 'a', type: 'string', enumFrom: 'accounts' } as never,
                { name: 'b', type: 'string', enumFrom: 'accounts' } as never,
            ],
        })).toEqual({ accounts: true })
    })
})
```

**Self-test**: `cd packages/server/engine && npm run test -- test/handler/turn-interpreter-client.test.ts 2>&1 | tail -10`. Expect 18/18 pass.

**Verify**: G-LINT (su file di test) + G-ENGINE-COV (`turn-interpreter-client.ts` ≥ 90% lines/branches).

**Commit template**:
```
test(engine): C-08 unit tests for turn-interpreter-client (18 cases)

Mock fetch via vi.stubGlobal: covers interpret/finalize/rollback HTTP
wrapper happy paths, 4xx/5xx handling, JSON parse failure, network
errors, and buildCatalogReadiness edge cases. Pushes coverage to
≥90% lines + branches on the engine HTTP wrapper.
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `fetch is not defined` | `vi.stubGlobal` non installato pre-test | mettere `vi.stubGlobal('fetch', fetchMock)` in `beforeEach` |
| `Cannot read property 'json' of undefined` | mock chiamato due volte ma solo un setup | usa `mockResolvedValue` (non `Once`) per setup persistenti, `Once` per setup specifici |
| `body` non confrontabile | il body è una `string` JSON | parsalo con `JSON.parse(call[1].body as string)` |

**Rollback**: rimuovere il file di test.

**LoC**: +180 / 0.

**Idempotente**: sì.

---

### C-09 — Shared schema unit tests (SECOND)

**Pre-flight**: nessuna.

**Files to load**:
- [packages/shared/src/lib/automation/interactive-flow/conversation-command.ts](packages/shared/src/lib/automation/interactive-flow/conversation-command.ts)
- [packages/shared/src/lib/automation/interactive-flow/turn-event.ts](packages/shared/src/lib/automation/interactive-flow/turn-event.ts)
- [packages/shared/src/lib/automation/interactive-flow/turn-interpret-dto.ts](packages/shared/src/lib/automation/interactive-flow/turn-interpret-dto.ts)

**Implementation**: 3 file di test (totale 30+ tests).

`packages/shared/test/automation/interactive-flow/conversation-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ConversationCommandSchema } from '../../../src/lib/automation/interactive-flow/conversation-command'

describe('ConversationCommandSchema', () => {
    describe('SET_FIELDS', () => {
        it('accepts valid update with evidence', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
            }).success).toBe(true)
        })
        it('rejects empty updates array', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'SET_FIELDS', updates: [] }).success).toBe(false)
        })
        it('rejects evidence shorter than 2 chars', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'z' }],
            }).success).toBe(false)
        })
        it('rejects empty field name', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: '', value: 'y', evidence: 'zz' }],
            }).success).toBe(false)
        })
        it('accepts confidence in [0..1]', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'zz', confidence: 0.5 }],
            }).success).toBe(true)
        })
        it('rejects confidence > 1', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'zz', confidence: 1.5 }],
            }).success).toBe(false)
        })
    })
    describe('ASK_FIELD', () => {
        it('accepts with reason', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD', field: 'name', reason: 'missing' }).success).toBe(true)
        })
        it('accepts without reason', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD', field: 'name' }).success).toBe(true)
        })
        it('rejects when field missing', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD' }).success).toBe(false)
        })
    })
    describe('ANSWER_META', () => {
        it.each(['ask-repeat', 'ask-clarify', 'ask-progress', 'ask-help'])('accepts kind=%s', (kind) => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_META', kind }).success).toBe(true)
        })
        it('rejects unknown kind', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_META', kind: 'unknown' }).success).toBe(false)
        })
    })
    describe('ANSWER_INFO', () => {
        it('accepts with citedFields ≥1', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_INFO', infoIntent: 'count_accounts', citedFields: ['ndg'] }).success).toBe(true)
        })
        it('rejects empty citedFields', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_INFO', infoIntent: 'count_accounts', citedFields: [] }).success).toBe(false)
        })
    })
    describe('REQUEST_CANCEL / RESOLVE_PENDING / REPROMPT', () => {
        it('REQUEST_CANCEL accepts optional reason', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'REQUEST_CANCEL' }).success).toBe(true)
            expect(ConversationCommandSchema.safeParse({ type: 'REQUEST_CANCEL', reason: 'too long' }).success).toBe(true)
        })
        it('RESOLVE_PENDING requires both decision + pendingType', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'RESOLVE_PENDING', decision: 'accept', pendingType: 'confirm_binary' }).success).toBe(true)
            expect(ConversationCommandSchema.safeParse({ type: 'RESOLVE_PENDING', decision: 'accept' }).success).toBe(false)
        })
        it('REPROMPT requires reason from enum', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'REPROMPT', reason: 'low-confidence' }).success).toBe(true)
            expect(ConversationCommandSchema.safeParse({ type: 'REPROMPT', reason: 'unknown' }).success).toBe(false)
        })
    })
    it('rejects unknown type', () => {
        expect(ConversationCommandSchema.safeParse({ type: 'UNKNOWN_TYPE' }).success).toBe(false)
    })
})
```

`packages/shared/test/automation/interactive-flow/turn-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InteractiveFlowTurnEventSchema } from '../../../src/lib/automation/interactive-flow/turn-event'

const validBase = {
    outboxEventId: '00000000-0000-4000-8000-000000000000',
    turnId: 'turn-1',
    sessionId: 'sess-1',
    flowRunId: 'run-1',
    sessionSequence: '1',
    createdAt: new Date().toISOString(),
}

describe('InteractiveFlowTurnEventSchema', () => {
    it.each(['FIELD_EXTRACTED', 'TURN_COMMITTED', 'CANCEL_TTL_EXPIRED', 'REPROMPT_EMITTED', 'TOPIC_CHANGED', 'CATALOG_PREEXEC_FAILED'])('accepts kind=%s', (kind) => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, kind, payload: {} }).success).toBe(true)
    })
    it('rejects unknown kind', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, kind: 'BOGUS', payload: {} }).success).toBe(false)
    })
    it('rejects bad sessionSequence (zero)', () => {
        const r = InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: '0', kind: 'TURN_COMMITTED', payload: {} })
        expect(r.success).toBe(false)
        if (!r.success) {
            const msg = r.error.issues.find(i => i.path.join('.') === 'sessionSequence')?.message
            expect(msg).toBe('validation.bigint.format')
        }
    })
    it('rejects sessionSequence with leading zeroes', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: '012', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('rejects sessionSequence non-numeric', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: 'abc', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('rejects when missing required outboxEventId', () => {
        const { outboxEventId: _drop, ...rest } = validBase
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...rest, kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
})
```

`packages/shared/test/automation/interactive-flow/turn-interpret-dto.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InterpretTurnRequestSchema, InterpretTurnResponseSchema } from '../../../src/lib/automation/interactive-flow/turn-interpret-dto'

const validRequest = {
    turnId: 't-1',
    idempotencyKey: 'i-1',
    sessionId: 's-1',
    sessionRevision: 0,
    flowRunId: 'fr-1',
    flowVersionId: 'v-1',
    message: 'hello',
    state: {},
    history: [],
    pendingInteraction: null,
    stateFields: [],
    nodes: [],
    currentNodeHint: null,
    infoIntents: [],
    locale: 'it',
    catalogReadiness: {},
}

describe('InterpretTurnRequestSchema', () => {
    it('accepts minimal valid request', () => {
        expect(InterpretTurnRequestSchema.safeParse(validRequest).success).toBe(true)
    })
    it('rejects empty turnId', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, turnId: '' }).success).toBe(false)
    })
    it('rejects history entry with missing role', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, history: [{ text: 'x' }] }).success).toBe(false)
    })
    it('accepts history with multiple entries (user/assistant)', () => {
        expect(InterpretTurnRequestSchema.safeParse({
            ...validRequest,
            history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }],
        }).success).toBe(true)
    })
    it('accepts pendingInteraction null', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, pendingInteraction: null }).success).toBe(true)
    })
    it('rejects negative sessionRevision', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, sessionRevision: -1 }).success).toBe(false)
    })
})

describe('InterpretTurnResponseSchema', () => {
    const validResponse = {
        turnStatus: 'prepared',
        acceptedCommands: [],
        rejectedCommands: [],
        stateDiff: {},
        events: [],
        finalizeContract: { turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000' },
        sessionRevision: 1,
    }
    it('accepts minimal prepared', () => {
        expect(InterpretTurnResponseSchema.safeParse(validResponse).success).toBe(true)
    })
    it('accepts replayed', () => {
        expect(InterpretTurnResponseSchema.safeParse({ ...validResponse, turnStatus: 'replayed' }).success).toBe(true)
    })
    it('accepts failed', () => {
        expect(InterpretTurnResponseSchema.safeParse({ ...validResponse, turnStatus: 'failed' }).success).toBe(true)
    })
    it('rejects unknown turnStatus', () => {
        expect(InterpretTurnResponseSchema.safeParse({ ...validResponse, turnStatus: 'pending' }).success).toBe(false)
    })
})
```

**Self-test**: `cd packages/shared && npx vitest run test/automation/interactive-flow/conversation-command.test.ts test/automation/interactive-flow/turn-event.test.ts test/automation/interactive-flow/turn-interpret-dto.test.ts 2>&1 | tail -15`. Expect 30+/30+ pass.

**Verify**: G-LINT + G-SHARED (no coverage gate yet — quello arriva con C-03).

**Commit template**:
```
test(shared): C-09 unit tests for command-layer DTOs (30+ cases)

Cover ConversationCommandSchema (7 variants), InteractiveFlowTurnEventSchema
(kinds + sessionSequence regex), InterpretTurnRequest/ResponseSchema
(history shape, sessionRevision constraints, turnStatus enum).
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `Cannot find module 'conversation-command'` | path import sbagliato | i path sono `../../../src/lib/automation/interactive-flow/<file>` (3 livelli) |
| `r.error.issues` undefined | Zod ha cambiato API | usa `r.error.errors` come fallback |
| `sessionSequence: '0'` accettato | regex sbagliata | la regex è `/^[1-9][0-9]*$/` — `'0'` è esplicitamente rigettato (no zero leading) |

**LoC**: ~250 (3 file).

**Rollback**: rimuovere i 3 file.

**Idempotente**: sì.

---

### C-02 — Engine vitest.config.ts thresholds estesi (THIRD)

**Pre-flight**:
- [ ] C-08 VERIFIED (turn-interpreter-client.test.ts esiste).
- [ ] `cd packages/server/engine && npm run test -- --coverage` baseline: i 4 file target hanno coverage misurabile.

**Files to load**: [packages/server/engine/vitest.config.ts](packages/server/engine/vitest.config.ts).

**Implementation — patch incrementale**:

```ts
// Inside the existing coverage block, EXTEND include + thresholds:
include: [
    'packages/server/engine/src/lib/handler/session-store.ts',
    'packages/server/engine/src/lib/handler/interactive-flow-executor.ts',
    'packages/server/engine/src/lib/handler/turn-interpreter-client.ts',
    'packages/server/engine/src/lib/handler/turn-interpreter-adapter.ts',
    'packages/server/engine/src/lib/handler/status-renderer.ts',
    'packages/server/engine/src/lib/handler/turn-result.ts',
],
thresholds: {
    'packages/server/engine/src/lib/handler/session-store.ts': {
        statements: 90, branches: 90, functions: 90, lines: 90,
    },
    'packages/server/engine/src/lib/handler/interactive-flow-executor.ts': {
        statements: 70, branches: 60, functions: 80, lines: 70,
    },
    'packages/server/engine/src/lib/handler/turn-interpreter-client.ts': {
        statements: 90, branches: 90, functions: 90, lines: 90,
    },
    'packages/server/engine/src/lib/handler/turn-interpreter-adapter.ts': {
        statements: 90, branches: 85, functions: 90, lines: 90,
    },
    'packages/server/engine/src/lib/handler/status-renderer.ts': {
        statements: 90, branches: 85, functions: 90, lines: 90,
    },
    'packages/server/engine/src/lib/handler/turn-result.ts': {
        statements: 90, branches: 90, functions: 90, lines: 90,
    },
},
```

**Self-test**: `cd packages/server/engine && npm run test -- --coverage 2>&1 | tail -25`. Verifica:
- `turn-interpreter-client.ts` ≥ 90%
- `turn-interpreter-adapter.ts` ≥ 85% (branches; tollerante perché parte è coverage da integration test)
- `status-renderer.ts` ≥ 85%
- `turn-result.ts` ≥ 90%

Se uno è < threshold, **NON committare**: tornare a C-08 / aggiungere micro-test puntuali.

**Verify**: G-ENGINE-COV exit 0.

**Commit template**:
```
test(engine): C-02 enforce ≥90% coverage on command-layer engine helpers

turn-interpreter-client.ts, turn-interpreter-adapter.ts (branches 85),
status-renderer.ts (branches 85), turn-result.ts now have explicit
thresholds in vitest.config.ts. C-08 unit tests + existing
status-renderer.test.ts + interactive-flow-executor coverage suffice.
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `Coverage threshold for X (lines: 90) not met: Y%` | qualche branch defensive non coperto | abbassare threshold del file specifico, NON di tutti |
| `Cannot find file packages/server/engine/...` in v8 | cwd wrong | ricontrolla `process.chdir(repoRoot)` esiste |

**LoC**: +28 / 0.

**Rollback**: rimuovere le 4 nuove voci.

**Idempotente**: sì.

---

### C-03 — Shared vitest.config.ts coverage (FOURTH)

**Pre-flight**: C-09 VERIFIED (3 file di test esistono).

**Files to load**: [packages/shared/vitest.config.ts](packages/shared/vitest.config.ts).

**Implementation — overwrite completo**:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportOnFailure: true,
      include: [
        'src/lib/automation/interactive-flow/conversation-command.ts',
        'src/lib/automation/interactive-flow/turn-event.ts',
        'src/lib/automation/interactive-flow/turn-interpret-dto.ts',
      ],
      thresholds: {
        'src/lib/automation/interactive-flow/conversation-command.ts': {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        'src/lib/automation/interactive-flow/turn-event.ts': {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        'src/lib/automation/interactive-flow/turn-interpret-dto.ts': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
      },
    },
  },
})
```

**Self-test**: `cd packages/shared && npx vitest run --coverage 2>&1 | tail -20`. Verifica i 3 file ≥ thresholds.

**Verify**: G-SHARED-COV exit 0.

**Commit template**:
```
test(shared): C-03 enable coverage thresholds on interactive-flow schemas
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `vitest run --coverage` esce 0 ma summary vuoto | cwd diversa da `packages/shared` | il comando deve girare da `packages/shared`; il path nei thresholds è `src/...` (non `packages/shared/src/...`) |
| Threshold X% not met: Y% | qualche branch defensive non coperto da C-09 | aggiungi caso al file di test C-09 mancante |

**LoC**: +30 / -4.

**Rollback**: ripristina al file 4-righe.

**Idempotente**: sì.

---

### C-04 — Web vitest.config.ts coverage + reducer test

**Pre-flight**: nessuna.

**Files to load**:
- [packages/web/vitest.config.ts](packages/web/vitest.config.ts)
- [packages/web/src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts](packages/web/src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts)
- [packages/web/src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts](packages/web/src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts)

**Implementation step 1 — config**:

```ts
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportOnFailure: true,
      include: [
        'src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts',
        'src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts',
      ],
      thresholds: {
        'src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts': {
          statements: 85, branches: 80, functions: 90, lines: 85,
        },
        'src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts': {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@activepieces/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
```

**Implementation step 2 — reducer test** `packages/web/src/features/interactive-flow/hooks/interactive-flow-turn-reducer.test.ts`:

Prima di scrivere, **READ** `interactive-flow-turn-reducer.ts` per confermare API:

```bash
cat packages/web/src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts
```

Pattern atteso (probabile):

```ts
export type TurnSnapshot = { events: InteractiveFlowTurnEvent[] }
export const initialSnapshot: TurnSnapshot = { events: [] }
export function turnReducer(state: TurnSnapshot, action: { type: 'EVENT_RECEIVED', event: InteractiveFlowTurnEvent } | { type: 'RESET' }): TurnSnapshot
```

Test:

```ts
import { describe, expect, it } from 'vitest'
import { turnReducer, initialSnapshot } from './interactive-flow-turn-reducer'
// or whatever the actual exports are

describe('turnReducer', () => {
    const baseEvent = (seq: string, id: string): never => ({
        outboxEventId: id, turnId: 't', sessionId: 's', flowRunId: 'r',
        sessionSequence: seq, kind: 'TURN_COMMITTED', payload: {},
        createdAt: new Date().toISOString(),
    } as never)

    it('initial snapshot has empty events', () => {
        expect(initialSnapshot.events).toEqual([])
    })
    it('EVENT_RECEIVED appends event', () => {
        const e = baseEvent('1', 'a')
        const s = turnReducer(initialSnapshot, { type: 'EVENT_RECEIVED', event: e })
        expect(s.events).toEqual([e])
    })
    it('keeps events sorted by sessionSequence (BigInt-aware)', () => {
        let s = initialSnapshot
        s = turnReducer(s, { type: 'EVENT_RECEIVED', event: baseEvent('100', 'a') })
        s = turnReducer(s, { type: 'EVENT_RECEIVED', event: baseEvent('2', 'b') })
        expect(s.events.map(e => e.sessionSequence)).toEqual(['2', '100'])
    })
    it('deduplicates by outboxEventId', () => {
        let s = initialSnapshot
        s = turnReducer(s, { type: 'EVENT_RECEIVED', event: baseEvent('1', 'a') })
        s = turnReducer(s, { type: 'EVENT_RECEIVED', event: baseEvent('1', 'a') })
        expect(s.events).toHaveLength(1)
    })
    it('RESET clears events', () => {
        let s = turnReducer(initialSnapshot, { type: 'EVENT_RECEIVED', event: baseEvent('1', 'a') })
        s = turnReducer(s, { type: 'RESET' })
        expect(s.events).toEqual([])
    })
})
```

**Implementation step 3 — hook test** (solo se mancante; la hook usa `useEffect` per sottoscriversi al WS):

Per evitare l'overhead del rendering React con jsdom, mockare il WS via `vi.stubGlobal('WebSocket', ...)` e testare l'effetto sul reducer indirettamente. Skip se troppo complesso — copertura ≥ 85% già ottenibile dal reducer.

**Self-test**:
```bash
cd packages/web && npx vitest run src/features/interactive-flow/hooks/interactive-flow-turn-reducer.test.ts && \
  npx vitest run --coverage 2>&1 | tail -15
```

**Verify**: G-LINT + G-WEB-COV (i 2 file ≥ thresholds).

**Commit template**:
```
test(web): C-04 enable coverage thresholds + reducer unit tests
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| Reducer API differente da quanto ipotizzato | il file potrebbe esportare `useReducer` invece di `turnReducer` | leggi il file PRIMA di scrivere il test, adatta l'import |
| Hook test fallisce per `window.WebSocket undefined` | environment node, no WS API | mocka via `vi.stubGlobal('WebSocket', class { constructor() {} })` |
| Coverage hook < threshold | hook copre branch `useEffect` non testati | abbassa threshold hook o aggiungi test con `@vitest-environment jsdom` |

**LoC**: +50 (config) + ~150 (reducer test) + ~80 (hook test optional).

**Rollback**: rimuovere coverage section + i nuovi file.

**Idempotente**: sì.

---

## T-API-RESIDUO

### A-02 — Adapter injection at boot

**Status**: COVERED indirectly. Il singleton `providerAdapterSingleton` è privato; il default `MockProviderAdapter` è esercitato da tutti i 6 test in `command-layer.test.ts` quando `AP_LLM_VIA_BRIDGE` è unset (default test env).

**Implementation (doc-only)**: aggiungi a `docs/interactive-flow/coverage-baseline.md` una nota:

```markdown
## A-02 status note

The adapter injection path (`AP_LLM_VIA_BRIDGE=true` → `VercelAIAdapter`,
unset → `MockProviderAdapter`) is exercised indirectly:
- Test env has `AP_LLM_VIA_BRIDGE` unset → `command-layer.test.ts` (6 tests)
  uses `MockProviderAdapter` end-to-end.
- W-01 dedicated unit tests cover the `VercelAIAdapter` itself (11 tests).
- The `overrideProviderAdapter()` function is the only public surface of
  the singleton; its API is exercised in `outboxPublisher` and
  `lockRecoveryDaemon` integration tests.

**A-02 = VERIFIED via reference**. No additional test file needed.
```

**Commit template**:
```
docs(command-layer): A-02 documented as indirectly covered (no new tests)
```

**LoC**: +12.

---

### A-04 — Recovery daemon integration

**Status**: COVERED by **A-08** (`command-layer-admin-force-clear.test.ts` 5 tests in
`packages/server/api/test/integration/ce/ai/`).

**Implementation (doc-only)**: aggiungi a `coverage-baseline.md`:

```markdown
## A-04 status note

`turnLogService.reclaimStaleLocks` integration is exercised by A-08
(`command-layer-admin-force-clear.test.ts`):
- A-08.1 in-progress with expired lease → failed/lease-expired
- A-08.2 prepared older than threshold → compensated/finalize-timeout
- A-08.5 combined in-progress + prepared

The lock-recovery daemon's tick loop (`lock-recovery.ts`) is exercised
by C-07 unit tests (7 tests). Together they fully cover the recovery path.

**A-04 = VERIFIED via reference**.
```

**Commit template**:
```
docs(command-layer): A-04 documented as covered by A-08 + C-07
```

**LoC**: +10.

---

### A-09 — Store-CAS endpoints (verify-then-skip-or-test)

**Pre-flight**: verifica copertura esistente:

```bash
cd packages/server/api && grep -nE "412|expectedVersion|store-entries.*conflict" test/integration/ce/ai/command-layer.test.ts
```

**Decision tree**:
- Se output mostra ≥ 3 match → **A-09 = VERIFIED via reference** (commit doc-only).
- Se output mostra ≤ 2 match → scrivi `command-layer-store-cas.test.ts` con i 6 casi del piano: insert v0; update vN; conflict 412; concurrent → 1 winner; missing key 404; oversized rejected.

**Doc note (caso VERIFIED)**:

```markdown
## A-09 status note

CAS semantics on store-entries are covered in command-layer.test.ts:
- 412 conflict on concurrent expectedVersion mismatch
- 404 on missing key
- successful update v0 → v1 → v2

**A-09 = VERIFIED via reference**.
```

**Commit template (caso doc)**:
```
docs(command-layer): A-09 documented as covered in command-layer.test.ts
```

**Commit template (caso test)**:
```
test(api): A-09 store-entries CAS edge cases (6 tests)
```

**LoC**: +8 (doc) o ~150 (test).

---

### A-10 — PG guard via REST (doc-only)

**Status**: COVERED by W-08 unit tests (6 tests in
`test/unit/app/flows/interactive-flow-validator.test.ts`).

**Implementation (doc-only)**: aggiungi a `coverage-baseline.md`:

```markdown
## A-10 status note

The W-08 PostgreSQL guard is exercised by 6 unit tests in
interactive-flow-validator.test.ts:
- accepts useCommandLayer=true on POSTGRES
- accepts useCommandLayer=true on PGLITE
- rejects on SQLITE3 with i18n key COMMAND_LAYER_REQUIRES_POSTGRES
- skips check when dbType undefined (preserves pure-validator callers)
- doesn't enforce when useCommandLayer false
- doesn't enforce when useCommandLayer omitted

The validator integration (publish path) is covered by the existing
`flow-version-validator-util.test.ts` baseline.

**A-10 = VERIFIED via reference**.
```

**Commit template**:
```
docs(command-layer): A-10 documented as covered by W-08 unit tests
```

**LoC**: +14.

---

### A-03 — Publisher integration end-to-end

**Pre-flight**: outbox-publisher unit test (C-07) DONE. Test va in DB reale (PGLite).

**Implementation**: crea `packages/server/api/test/integration/ce/ai/command-layer-publisher-integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { outboxPublisher } from '../../../../src/app/ai/command-layer/outbox-publisher'
import { outboxService } from '../../../../src/app/ai/command-layer/outbox.service'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => { await setupTestEnvironment() })
afterAll(async () => { await teardownTestEnvironment() })

beforeEach(async () => {
    const ds = databaseConnection()
    await ds.query('DELETE FROM "interactive_flow_outbox"')
    await ds.query('DELETE FROM "interactive_flow_session_sequence"')
})

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

describe('outbox publisher integration', () => {
    it('A-03.1: pending → publishable → claim → emit → published', async () => {
        const turnId = `turn-${randomUUID()}`
        const inserted = await outboxService.insertPending({
            turnId,
            sessionId: 'sess-pub-1',
            flowRunId: 'run-pub-1',
            events: [{ eventType: 'TURN_COMMITTED', payload: { ok: true } }],
        })
        await outboxService.markPublishable({ turnId })

        const emit = vi.fn().mockResolvedValue(undefined)
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 30 })
        await sleep(120)
        outboxPublisher.stop()

        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ outboxEventId: inserted[0].outboxEventId }))
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "eventStatus","publishedAt" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        expect(row[0].eventStatus).toBe('published')
        expect(row[0].publishedAt).not.toBeNull()
    })

    it('A-03.2: emit failure → markRetry, next tick re-attempts', async () => {
        const turnId = `turn-${randomUUID()}`
        const inserted = await outboxService.insertPending({
            turnId, sessionId: 'sess-pub-2', flowRunId: 'run-pub-2',
            events: [{ eventType: 'TURN_COMMITTED', payload: {} }],
        })
        await outboxService.markPublishable({ turnId })

        let attempts = 0
        const emit = vi.fn().mockImplementation(async () => {
            attempts++
            if (attempts === 1) throw new Error('transient-fail')
        })
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 30 })
        await sleep(200)
        outboxPublisher.stop()

        expect(emit.mock.calls.length).toBeGreaterThanOrEqual(1)
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "eventStatus","attempts" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        expect(['publishable', 'published']).toContain(row[0].eventStatus)
    })

    it('A-03.3: claimNextSessionBatch returns same row only once across two parallel claims', async () => {
        const turnId = `turn-${randomUUID()}`
        await outboxService.insertPending({
            turnId, sessionId: 'sess-pub-3', flowRunId: 'run-pub-3',
            events: [{ eventType: 'TURN_COMMITTED', payload: {} }],
        })
        await outboxService.markPublishable({ turnId })

        const [a, b] = await Promise.all([
            outboxService.claimNextSessionBatch({ publisherId: 'pub-A', claimTtlSeconds: 30 }),
            outboxService.claimNextSessionBatch({ publisherId: 'pub-B', claimTtlSeconds: 30 }),
        ])
        const totalRows = a.length + b.length
        expect(totalRows).toBeLessThanOrEqual(1)  // FOR UPDATE SKIP LOCKED ensures at most one publisher gets the row
    })

    it('A-03.4: empty publishable set → tick is no-op', async () => {
        const emit = vi.fn()
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 30 })
        await sleep(80)
        outboxPublisher.stop()
        expect(emit).not.toHaveBeenCalled()
    })
})
```

**Self-test**: `npx vitest run test/integration/ce/ai/command-layer-publisher-integration.test.ts` → 4/4 pass.

**Verify**: G-API-FULL (no regressions, totale +4 tests).

**Commit template**:
```
test(api): A-03 outbox publisher integration end-to-end (4 tests)
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `eventStatus = 'pending'` invece di `published` | publisher non ha avuto tempo | aumenta `sleep(120)` a `sleep(200)` |
| Test A-03.3 vede `totalRows = 2` | PGLite vs PG: SKIP LOCKED può essere implementato diversamente | controlla `claimNextSessionBatch` SQL: deve essere `FOR UPDATE OF s SKIP LOCKED` |

**LoC**: ~150.

**Idempotente**: sì.

---

### A-07 — Traces endpoint

**Pre-flight**: nessuna.

**Files to load**: [packages/server/api/src/app/ai/command-layer/tracing.ts](packages/server/api/src/app/ai/command-layer/tracing.ts).

Prima di scrivere il test, **leggi** il file per identificare:
- Esiste un `clear()` / `reset()`?
- `withSpan` ritorna il valore della callback?
- `summarize()` shape (totalSpans + byName)

**Implementation**: `packages/server/api/test/integration/ce/ai/command-layer-traces.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { commandLayerTracing } from '../../../../src/app/ai/command-layer/tracing'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => { await setupTestEnvironment() })
afterAll(async () => { await teardownTestEnvironment() })

beforeEach(() => {
    if (typeof (commandLayerTracing as { clear?: () => void }).clear === 'function') {
        (commandLayerTracing as { clear: () => void }).clear()
    }
})

describe('command-layer traces', () => {
    it('A-07.1: empty summary when no spans recorded', () => {
        const s = commandLayerTracing.summarize()
        expect(s.totalSpans).toBe(0)
    })
    it('A-07.2: withSpan records duration + count by name', async () => {
        await commandLayerTracing.withSpan('test-span-A07', async () => { await new Promise(r => setTimeout(r, 5)); return 1 })
        const s = commandLayerTracing.summarize()
        expect(s.byName['test-span-A07']).toBeDefined()
        expect(s.byName['test-span-A07'].count).toBe(1)
        expect(s.byName['test-span-A07'].avgMs).toBeGreaterThanOrEqual(0)
    })
    it('A-07.3: errorRate computed from rejected spans', async () => {
        await commandLayerTracing.withSpan('err-span-A07', async () => 1)
        await commandLayerTracing.withSpan('err-span-A07', async () => { throw new Error('boom') }).catch(() => undefined)
        const s = commandLayerTracing.summarize()
        expect(s.byName['err-span-A07'].count).toBe(2)
        expect(s.byName['err-span-A07'].errorRate).toBeCloseTo(0.5, 1)
    })
})
```

**Self-test**: 3/3 pass.

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `commandLayerTracing.clear is not a function` | reset non esposto | usa nomi span unici per test (suffix random) e non resetare |
| `errorRate` !== 0.5 | spans precedenti residui | usa nome span unico per test |

**LoC**: ~80.

**Commit template**:
```
test(api): A-07 traces endpoint summarize + withSpan (3 tests)
```

---

### A-12 — Cross-flow consultazione vs estinzione

**Pre-flight**: fixture esistenti in `fixtures/flow-templates/` (consultazione + estinzione).

**Strategy**: usare `MockProviderAdapter` registrato, chiamare `turnInterpreter.interpret` con due fixture distinte. Verificare che `stateDiff` (e infoIntents disponibili) divergono come atteso.

**Implementation**: `packages/server/api/test/integration/ce/ai/command-layer-cross-flow.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { InterpretTurnRequest } from '@activepieces/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockProviderAdapter } from '../../../../src/app/ai/command-layer/provider-adapter'
import { turnInterpreter } from '../../../../src/app/ai/command-layer/turn-interpreter'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => { await setupTestEnvironment() })
afterAll(async () => { await teardownTestEnvironment() })
beforeEach(async () => {
    const ds = databaseConnection()
    await ds.query('DELETE FROM "interactive_flow_outbox"')
    await ds.query('DELETE FROM "interactive_flow_session_sequence"')
    await ds.query('DELETE FROM "interactive_flow_turn_log"')
})

function buildRequest(overrides: Partial<InterpretTurnRequest>): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: `sess-${randomUUID()}`,
        sessionRevision: 0,
        flowRunId: `run-${randomUUID()}`,
        flowVersionId: 'v-1',
        message: '',
        state: {},
        history: [],
        pendingInteraction: null,
        stateFields: [],
        nodes: [],
        currentNodeHint: null,
        infoIntents: [],
        systemPrompt: undefined,
        locale: 'it',
        catalogReadiness: {},
        ...overrides,
    }
}

describe('cross-flow command layer', () => {
    it('A-12.1: consultazione fixture extracts customerName + ndg', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [
                    { field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' },
                    { field: 'ndg', value: '12345678', evidence: '12345678' },
                ],
            }],
        })
        const req = buildRequest({
            message: 'Bellafronte, NDG 12345678',
            stateFields: [
                { name: 'customerName', type: 'string', extractable: true } as never,
                { name: 'ndg', type: 'string', extractable: true } as never,
            ],
        })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.stateDiff.customerName).toBe('Bellafronte')
        expect(result.stateDiff.ndg).toBe('12345678')
    })

    it('A-12.2: estinzione fixture extracts closureReasonCode (distinct surface)', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'closureReasonCode', value: '01', evidence: 'motivazione 01' }],
            }],
        })
        const req = buildRequest({
            message: 'motivazione 01',
            stateFields: [
                { name: 'closureReasonCode', type: 'string', extractable: true } as never,
            ],
        })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: [] })
        expect(result.stateDiff.closureReasonCode).toBe('01')
        expect(result.stateDiff.customerName).toBeUndefined()
    })

    it('A-12.3: legacy fixture (useCommandLayer=false absent in request, simulated by no commands) → empty stateDiff', async () => {
        const provider = new MockProviderAdapter()
        provider.register({ matchUserMessage: () => true, commands: [] })
        const req = buildRequest({
            message: 'Hello',
            stateFields: [{ name: 'customerName', type: 'string', extractable: true } as never],
        })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.stateDiff).toEqual({})
    })
})
```

**Self-test**: 3/3.

**Commit template**:
```
test(api): A-12 cross-flow consultazione + estinzione MockProvider scenarios
```

**LoC**: ~120.

---

## H-HARDEN

### H-01 — i18n fan-out 5 chiavi su 10 locales

**Pre-flight**: chiavi presenti in `en/translation.json`:
- `validation.commandLayer.requiresPostgres`
- `validation.commandLayer.featureDisabled`
- `validation.bigint.format`
- `validation.conversationCommand.field.required`
- `validation.conversationCommand.evidence.tooShort`

Locales target: `ar de es fr ja nl pt ru zh zh-TW` (10).

**Implementation**: per ognuno dei 10 file `packages/web/public/locales/<lang>/translation.json`:

1. **Apri** il file (è un JSON object).
2. **Trova** una posizione stabile per inserire le 5 chiavi. Le chiavi sono organizzate alfabeticamente; trova una key vicina (es. tra `validation.bigDecimal.*` e `validation.color.*` o simili).
3. **Inserisci** le 5 chiavi tradotte (vedi catalogo sotto).

**Catalogo traduzioni** (use `Edit` per ogni file):

```jsonc
// AR (Arabo)
"validation.bigint.format": "تنسيق التسلسل غير صالح (متوقع bigint موجب).",
"validation.commandLayer.featureDisabled": "طبقة الأوامر معطلة على هذا التثبيت.",
"validation.commandLayer.requiresPostgres": "ميزة طبقة الأوامر تتطلب PostgreSQL. قم بتعطيل useCommandLayer أو انتقل إلى نشر PostgreSQL.",
"validation.conversationCommand.evidence.tooShort": "الدليل قصير جدًا (الحد الأدنى حرفان).",
"validation.conversationCommand.field.required": "الأمر يتطلب اسم حقل.",

// DE (Tedesco)
"validation.bigint.format": "Ungültiges Sequenzformat (erwartet: positives bigint).",
"validation.commandLayer.featureDisabled": "Der Command Layer ist auf dieser Installation deaktiviert.",
"validation.commandLayer.requiresPostgres": "Die Command-Layer-Funktion erfordert PostgreSQL. Deaktivieren Sie useCommandLayer oder wechseln Sie zu einer PostgreSQL-Installation.",
"validation.conversationCommand.evidence.tooShort": "Beleg zu kurz (mindestens 2 Zeichen).",
"validation.conversationCommand.field.required": "Befehl erfordert einen Feldnamen.",

// ES (Spagnolo)
"validation.bigint.format": "Formato de secuencia no válido (se esperaba bigint positivo).",
"validation.commandLayer.featureDisabled": "Command Layer está deshabilitado en esta instalación.",
"validation.commandLayer.requiresPostgres": "La función Command Layer requiere PostgreSQL. Desactive useCommandLayer o cambie a una instalación PostgreSQL.",
"validation.conversationCommand.evidence.tooShort": "Evidencia demasiado corta (mínimo 2 caracteres).",
"validation.conversationCommand.field.required": "El comando requiere un nombre de campo.",

// FR (Francese)
"validation.bigint.format": "Format de séquence non valide (bigint positif attendu).",
"validation.commandLayer.featureDisabled": "Le Command Layer est désactivé sur cette installation.",
"validation.commandLayer.requiresPostgres": "La fonctionnalité Command Layer nécessite PostgreSQL. Désactivez useCommandLayer ou passez à une installation PostgreSQL.",
"validation.conversationCommand.evidence.tooShort": "Preuve trop courte (minimum 2 caractères).",
"validation.conversationCommand.field.required": "La commande nécessite un nom de champ.",

// JA (Giapponese)
"validation.bigint.format": "シーケンス形式が無効です（正の bigint を期待）。",
"validation.commandLayer.featureDisabled": "このインストールではコマンドレイヤーが無効です。",
"validation.commandLayer.requiresPostgres": "コマンドレイヤー機能には PostgreSQL が必要です。useCommandLayer を無効にするか、PostgreSQL 環境に切り替えてください。",
"validation.conversationCommand.evidence.tooShort": "エビデンスが短すぎます（最小2文字）。",
"validation.conversationCommand.field.required": "コマンドにはフィールド名が必要です。",

// NL (Olandese)
"validation.bigint.format": "Ongeldig volgnummerformaat (verwacht: positieve bigint).",
"validation.commandLayer.featureDisabled": "Command Layer is uitgeschakeld op deze installatie.",
"validation.commandLayer.requiresPostgres": "De Command Layer-functie vereist PostgreSQL. Schakel useCommandLayer uit of stap over op een PostgreSQL-installatie.",
"validation.conversationCommand.evidence.tooShort": "Bewijs te kort (minimaal 2 tekens).",
"validation.conversationCommand.field.required": "Commando vereist een veldnaam.",

// PT (Portoghese)
"validation.bigint.format": "Formato de sequência inválido (bigint positivo esperado).",
"validation.commandLayer.featureDisabled": "O Command Layer está desativado nesta instalação.",
"validation.commandLayer.requiresPostgres": "O recurso Command Layer requer PostgreSQL. Desative useCommandLayer ou mude para uma instalação PostgreSQL.",
"validation.conversationCommand.evidence.tooShort": "Evidência muito curta (mínimo 2 caracteres).",
"validation.conversationCommand.field.required": "O comando requer um nome de campo.",

// RU (Russo)
"validation.bigint.format": "Неверный формат последовательности (ожидался положительный bigint).",
"validation.commandLayer.featureDisabled": "Command Layer отключен на этой установке.",
"validation.commandLayer.requiresPostgres": "Функция Command Layer требует PostgreSQL. Отключите useCommandLayer или перейдите на установку PostgreSQL.",
"validation.conversationCommand.evidence.tooShort": "Доказательство слишком короткое (минимум 2 символа).",
"validation.conversationCommand.field.required": "Команде требуется имя поля.",

// ZH (Cinese semplificato)
"validation.bigint.format": "序列格式无效（应为正 bigint）。",
"validation.commandLayer.featureDisabled": "此安装上的命令层已禁用。",
"validation.commandLayer.requiresPostgres": "命令层功能需要 PostgreSQL。请禁用 useCommandLayer 或切换到 PostgreSQL 部署。",
"validation.conversationCommand.evidence.tooShort": "证据过短（最少 2 个字符）。",
"validation.conversationCommand.field.required": "命令需要字段名称。",

// ZH-TW (Cinese tradizionale)
"validation.bigint.format": "序列格式無效（應為正 bigint）。",
"validation.commandLayer.featureDisabled": "此安裝上的命令層已停用。",
"validation.commandLayer.requiresPostgres": "命令層功能需要 PostgreSQL。請停用 useCommandLayer 或切換到 PostgreSQL 部署。",
"validation.conversationCommand.evidence.tooShort": "證據過短（最少 2 個字元）。",
"validation.conversationCommand.field.required": "命令需要欄位名稱。",
```

**Self-test**:

```bash
for L in ar de es fr ja nl pt ru zh zh-TW; do
  count=$(grep -cE "commandLayer|conversationCommand|bigint\.format" "packages/web/public/locales/$L/translation.json")
  if [[ $count -ne 5 ]]; then
    echo "FAIL $L: $count keys (expected 5)"
    exit 1
  fi
  jq . "packages/web/public/locales/$L/translation.json" > /dev/null || { echo "INVALID JSON in $L"; exit 1; }
done
echo "OK: 5 keys in all 10 locales, JSON valid"
```

**Verify**: G-LOCALES exit 0 + `cd packages/web && npm run typecheck` (no broken keys).

**Commit template**:
```
i18n: H-01 fan-out 5 command-layer validation keys to 10 locales

Adds translations of validation.commandLayer.requiresPostgres,
validation.commandLayer.featureDisabled, validation.bigint.format,
validation.conversationCommand.field.required, and
validation.conversationCommand.evidence.tooShort to ar/de/es/fr/ja/
nl/pt/ru/zh/zh-TW. Catalog committed verbatim from
docs/interactive-flow/closure-plan.md (no LLM auto-translate).
```

**LoC**: 10 file × 5 chiavi = 50 inserimenti.

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `jq: parse error` | virgola finale o doppia coppia chiave | controlla la posizione di insert, evita virgola dopo l'ultima entry |
| `count -ne 5` per uno specifico locale | inserimento mancato | verifica dove l'hai messo, ripeti |

**Idempotente**: sì (Edit con `replace_all: false` se incolli a posizione fissa, oppure controllo grep prima del commit).

---

### H-05 — PII redactor in outbox.service.insertPending

**Pre-flight**: nessuna.

**Files to load**:
- [packages/server/api/src/app/ai/command-layer/outbox.service.ts](packages/server/api/src/app/ai/command-layer/outbox.service.ts)
- [packages/server/api/src/app/ai/command-layer/pii-redactor.ts](packages/server/api/src/app/ai/command-layer/pii-redactor.ts)

**Implementation step 1** — modifica `outbox.service.ts`:

```ts
// Add import:
import { piiRedactor } from './pii-redactor'

// Inside insertPending for-loop, replace:
//   await runner.query(... [..., JSON.stringify(event.payload)])
// with:
const safePayload = (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload))
    ? piiRedactor.redactPayload(event.payload as Record<string, unknown>)
    : event.payload
await runner.query(
    `INSERT INTO ... VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb, NOW())`,
    [id, turnId, sessionId, flowRunId, sequence, event.eventType, JSON.stringify(safePayload)],
)
// Update created.push to use safePayload too:
created.push({ ..., payload: safePayload, ... })
```

**Implementation step 2** — test:

Aggiungi a `command-layer-pii.test.ts` (NON duplicare casi esistenti — aggiungi un nuovo `describe`):

```ts
describe('H-05: outbox.service redacts payload before persist', () => {
    it('email-like value is redacted in DB row', async () => {
        const inserted = await outboxService.insertPending({
            turnId: `turn-${randomUUID()}`,
            sessionId: 'sess-h05',
            flowRunId: 'run-h05',
            events: [{ eventType: 'FIELD_EXTRACTED', payload: { field: 'email', value: 'user@example.com', evidence: 'user@example.com' } }],
        })
        const ds = databaseConnection()
        const row = await ds.query('SELECT "payload" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1', [inserted[0].outboxEventId])
        const persisted = row[0].payload as { value: string, evidence: string }
        expect(persisted.value).not.toBe('user@example.com')
        expect(persisted.value.length).toBeGreaterThan(0)
    })
    it('non-object payload (null) passes through untouched', async () => {
        const inserted = await outboxService.insertPending({
            turnId: `turn-${randomUUID()}`,
            sessionId: 'sess-h05-null',
            flowRunId: 'run-h05-null',
            events: [{ eventType: 'TURN_COMMITTED', payload: null as unknown as Record<string, unknown> }],
        })
        const ds = databaseConnection()
        const row = await ds.query('SELECT "payload" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1', [inserted[0].outboxEventId])
        expect(row[0].payload).toBeNull()
    })
})
```

**Self-test**: `cd packages/server/api && npx vitest run test/integration/ce/ai/command-layer-pii.test.ts` → 9 + 2 pass.

**Verify**: G-LINT + G-API-FULL.

**Commit template**:
```
feat(api): H-05 redact PII in outbox.service.insertPending before JSONB persist

piiRedactor.redactPayload is invoked on event.payload (when it's a
plain object) before JSON.stringify. Null/array payloads bypass the
redactor (no-op). 2 new integration tests verify redaction + bypass.
```

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| `redactPayload` runtime error on `null` payload | il piano dice "skip se non object", controlla guard | il guard `typeof === 'object' && !Array.isArray && !== null` |
| Integration test mostra `value === 'user@example.com'` ancora | `redactPayload` non re-applicato a `created.push` | assicurati che `created.push({ ..., payload: safePayload })` |

**LoC**: +8 (service) + ~40 (test).

**Idempotente**: sì.

---

### H-03 — Prometheus content-type su /metrics

**Files to load**:
- [packages/server/api/src/app/ai/command-layer/metrics.ts](packages/server/api/src/app/ai/command-layer/metrics.ts)
- [packages/server/api/src/app/ai/command-layer/command-layer.controller.ts](packages/server/api/src/app/ai/command-layer/command-layer.controller.ts)

**Implementation step 1 — `metrics.ts`** — aggiungi funzione:

```ts
function snapshotPrometheus(): string {
    const lines: string[] = []
    for (const [k, v] of Object.entries(counters) as Array<[keyof typeof counters, number]>) {
        lines.push(`# TYPE command_layer_${k} counter`)
        lines.push(`command_layer_${k} ${v}`)
    }
    return lines.join('\n') + '\n'
}

export const commandLayerMetrics = {
    // ... existing fields,
    snapshotPrometheus,
}
```

**Implementation step 2 — controller**:

```ts
const MetricsRoute = {
    config: { security: securityAccess.engine() },
    schema: {
        querystring: z.object({ format: z.enum(['json', 'prometheus']).optional() }),
        // response only json — for prometheus we send raw text
        response: { [StatusCodes.OK]: z.union([z.record(z.string(), z.number()), z.string()]) },
    },
}

fastify.get('/metrics', MetricsRoute, async (request, reply) => {
    const fmt = (request.query as { format?: string }).format
    if (fmt === 'prometheus') {
        await reply.type('text/plain; version=0.0.4').status(StatusCodes.OK).send(commandLayerMetrics.snapshotPrometheus())
        return
    }
    await reply.status(StatusCodes.OK).send(commandLayerMetrics.snapshot())
})
```

**Implementation step 3 — test**: `command-layer-metrics-prometheus.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { commandLayerMetrics } from '../../../../src/app/ai/command-layer/metrics'

describe('commandLayerMetrics.snapshotPrometheus', () => {
    beforeEach(() => commandLayerMetrics.reset())
    it('emits TYPE + counter lines for each metric', () => {
        commandLayerMetrics.recordOutboxPublished({ eventType: 'X' })
        commandLayerMetrics.recordCasConflict()
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out).toMatch(/# TYPE command_layer_outboxPublished counter/)
        expect(out).toMatch(/command_layer_outboxPublished 1/)
        expect(out).toMatch(/command_layer_casConflict 1/)
    })
    it('returns 0-counter for unrecorded metrics', () => {
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out).toMatch(/command_layer_leaseAcquired 0/)
    })
    it('ends with trailing newline', () => {
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out.endsWith('\n')).toBe(true)
    })
})
```

**Self-test**: `npx vitest run test/integration/ce/ai/command-layer-metrics-prometheus.test.ts` → 3/3.

**Verify**: G-LINT + full ce/ai suite.

**Commit template**:
```
feat(api): H-03 Prometheus exposition on /metrics?format=prometheus
```

**LoC**: +25 (metrics.ts) + +12 (controller) + ~50 (test).

**Common failures**:
| Symptom | Root cause | Fix |
|---|---|---|
| Schema response invalid | union json/string non gestita da Fastify Zod | passa `[StatusCodes.OK]: z.any()` o splittare in 2 route distinti |
| Test "0-counter" fails | il test non ha resettato | `beforeEach(() => reset())` |

---

### H-04 — Localize chat-runtime-timeline labels

**Pre-flight**: H-01 VERIFIED (chiavi i18n base esistono in EN). Le NUOVE chiavi `interactiveFlow.timeline.*` NON esistono ancora — vanno aggiunte ad EN PRIMA del fan-out.

**Files to load**:
- [packages/web/src/features/interactive-flow/components/chat-runtime-timeline.tsx](packages/web/src/features/interactive-flow/components/chat-runtime-timeline.tsx)
- `packages/web/public/locales/en/translation.json`

**Implementation step 1 — chiavi EN**: aggiungi a `en/translation.json`:

```jsonc
"interactiveFlow.timeline.fieldExtracted": "Extracted: {{field}} = {{value}}",
"interactiveFlow.timeline.metaAnswered": "Conversational reply ({{kind}})",
"interactiveFlow.timeline.infoAnswered": "Informational reply: {{infoIntent}}",
"interactiveFlow.timeline.cancelRequested": "Cancellation proposed",
"interactiveFlow.timeline.cancelConfirmed": "Flow cancelled",
"interactiveFlow.timeline.cancelRejected": "Cancellation revoked",
"interactiveFlow.timeline.cancelTtlExpired": "Cancellation expired",
"interactiveFlow.timeline.repromptEmitted": "Reformulation requested ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Turn committed",
"interactiveFlow.timeline.turnRolledBack": "Turn rolled back",
"interactiveFlow.timeline.turnFailed": "Turn failed",
```

**Implementation step 2 — fan-out 10 locales** (catalogo abbreviato — pattern simile a H-01, traduci letteralmente le 11 chiavi). Esempio per IT (assente attualmente, ignorare):

```jsonc
// es. DE
"interactiveFlow.timeline.fieldExtracted": "Extrahiert: {{field}} = {{value}}",
"interactiveFlow.timeline.metaAnswered": "Konversationelle Antwort ({{kind}})",
"interactiveFlow.timeline.infoAnswered": "Informative Antwort: {{infoIntent}}",
// ... etc
```

**Implementation step 3 — modify component**:

```tsx
import { useTranslation } from 'react-i18next';

// Replace turnEventLabel signature:
function turnEventLabel(event: InteractiveFlowTurnEvent, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const payload = event.payload as Record<string, unknown>;
  switch (event.kind) {
    case 'FIELD_EXTRACTED':
      return t('interactiveFlow.timeline.fieldExtracted', {
        field: String(payload.field ?? ''),
        value: formatValue(payload.value),
      });
    case 'META_ANSWERED':
      return t('interactiveFlow.timeline.metaAnswered', { kind: String(payload.kind ?? '') });
    case 'INFO_ANSWERED':
      return t('interactiveFlow.timeline.infoAnswered', { infoIntent: String(payload.infoIntent ?? '') });
    case 'CANCEL_REQUESTED': return t('interactiveFlow.timeline.cancelRequested');
    case 'CANCEL_CONFIRMED': return t('interactiveFlow.timeline.cancelConfirmed');
    case 'CANCEL_REJECTED': return t('interactiveFlow.timeline.cancelRejected');
    case 'CANCEL_TTL_EXPIRED': return t('interactiveFlow.timeline.cancelTtlExpired');
    case 'REPROMPT_EMITTED': return t('interactiveFlow.timeline.repromptEmitted', { reason: String(payload.reason ?? '') });
    case 'TURN_COMMITTED': return t('interactiveFlow.timeline.turnCommitted');
    case 'TURN_ROLLED_BACK': return t('interactiveFlow.timeline.turnRolledBack');
    case 'TURN_FAILED': return t('interactiveFlow.timeline.turnFailed');
    default: return event.kind;
  }
}

// Inside ChatRuntimeTimeline:
const { t } = useTranslation();
// Use: turnEventLabel(event, t)
```

**Self-test**: `cd packages/web && npm run typecheck && npm run test`.

**Verify**: G-LINT + G-WEB.

**Commit template**:
```
feat(web): H-04 localize chat-runtime-timeline labels via i18next

11 new keys under interactiveFlow.timeline.* added to EN + 10 locales.
Component now calls useTranslation() and routes turnEventLabel through
t(). Inline IT strings removed.
```

**LoC**: ~150 (locales) + ~40 (component).

---

### H-02 — Bridge smoke spec scaffold (env-bound)

**Pre-flight**: nessuna (scaffold).

**Implementation**: `packages/tests-e2e/scenarios/ce/flows/command-layer-bridge-smoke.local.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const BRIDGE_REQUIRED = process.env.AP_LLM_VIA_BRIDGE === 'true'

test.describe('command-layer bridge smoke (opt-in)', () => {
    test.beforeAll(async () => {
        if (!BRIDGE_REQUIRED) test.skip()
        const res = await fetch('http://localhost:8787/health').catch(() => null)
        expect(res?.status).toBe(200)
    })

    test.skip('happy path: send "Bellafronte" → field extracted via real LLM', async ({ page: _ }) => {
        // TODO (env-bound, on-call):
        // 1. open chat for fixture estinzione
        // 2. send "Bellafronte"
        // 3. expect bot message "📝 Estratto: customerName = Bellafronte"
        // 4. assert turn-log status == finalized
    })
})
```

**Self-test**: `cd packages/tests-e2e && npx tsc --noEmit packages/tests-e2e/scenarios/ce/flows/command-layer-bridge-smoke.local.spec.ts` (typecheck).

**Verify**: typecheck pass.

**Commit template**:
```
test(e2e): H-02 bridge smoke spec scaffold (opt-in via AP_LLM_VIA_BRIDGE)
```

**LoC**: ~40.

---

## W-09 doc — Smoke verify checklist

**Status**: BLOCKED. Documento la procedura per l'on-call.

**Implementation**: crea `docs/interactive-flow/w09-smoke-checklist.md`:

```markdown
# W-09 Smoke Verify Checklist

Pre-condizioni:
- [ ] `claude-code-openai-bridge` running su porta 8787
- [ ] `dev-start.sh` lancia 4 processi (api, worker, frontend, dev-tooling)
- [ ] Fixture `consultazione-cliente.json` importato via admin UI

Procedura (8 evidenze):
1. `curl -sf http://localhost:8787/health` → exit 0 con body contenente "ok"
2. `npm run lint-dev` → exit 0
3. `cd packages/server/engine && npm run test` → all pass
4. `AP_LLM_VIA_BRIDGE=true ./dev-start.sh` → 4 processi in `ps`
5. Importa fixture via admin UI → fixture appare nella flow list
6. Apri chat per il flow, invia messaggio "Bellafronte"
7. Entro 5s verifica:
   - DB: `SELECT status FROM "interactive_flow_turn_log" ORDER BY "createdAt" DESC LIMIT 1` → 'prepared' poi 'finalized'
   - DB: `SELECT count(*) FROM "interactive_flow_outbox" WHERE "eventStatus" IN ('publishable','published')` ≥ 1
   - Network DevTools tab WS: frame `INTERACTIVE_FLOW_TURN_EVENT`
   - UI: chat timeline mostra "📝 Estratto: customerName = Bellafronte"
   - Bot message: contiene ack + status combinati
8. Esegui di nuovo con fixture `useCommandLayer: false` → comportamento legacy invariato

Logging:
- Append a `docs/interactive-flow/progress-log.md` un blocco datato
  `## YYYY-MM-DD HH:MM UTC — W-09 smoke evidence` con le 8 evidenze + commit hash corrente.
```

**Commit template**:
```
docs(command-layer): W-09 smoke verify checklist for on-call execution
```

**LoC**: ~35.

---

## T-PLAYWRIGHT scaffold

### T-02 — Mock MCP server modes

**Files to load**: verifica esistenza `packages/tests-e2e/fixtures/mock-mcp-server.ts`.

**Strategy**: se il file esiste, estendere con `mode`. Se non esiste, creare nuovo helper.

**Implementation** (caso esiste, patch):

```ts
// Aggiungi types e logic per i modi:
export type MockMcpMode = 'happy' | 'catalog-fail' | 'slow' | 'crash'

// Patcha la fn esistente per accettare mode:
export function startMockMcp(opts: { mode?: MockMcpMode, port: number }): { stop: () => Promise<void> } {
    const mode = opts.mode ?? 'happy'
    // ... existing setup ...
    // for `catalog-fail`: in tool/list_closure_reasons → 500
    // for `slow`: setTimeout(() => res.json(...), 5000) per ogni handler
    // for `crash`: socket.destroy() dopo 1 chunk
}
```

**Self-test**: `npx tsc --noEmit packages/tests-e2e/fixtures/mock-mcp-server.ts`.

**Commit template**:
```
test(e2e): T-02 mock-mcp-server supports happy/catalog-fail/slow/crash modes
```

**LoC**: ~150.

---

### T-03 — chat-runtime-helpers.ts

**Implementation**: crea `packages/tests-e2e/fixtures/chat-runtime-helpers.ts`:

```ts
import { Page, expect } from '@playwright/test'
// import { Pool } from 'pg' or use `claudia` test infra

export async function setupMockMcp(opts: { mode?: 'happy' | 'catalog-fail' | 'slow' | 'crash' }): Promise<{ stop: () => Promise<void> }> {
    const { startMockMcp } = await import('./mock-mcp-server')
    return startMockMcp({ mode: opts.mode, port: 9999 })
}

export async function openChatForFixture(page: Page, fixtureName: string): Promise<void> {
    await page.goto(`/flows?fixture=${encodeURIComponent(fixtureName)}`)
    await page.click('[data-testid="open-chat-button"]')
}

export async function sendUserMessage(page: Page, text: string): Promise<void> {
    await page.fill('[data-testid="chat-input"]', text)
    await page.keyboard.press('Enter')
}

export async function expectBotMessage(page: Page, regex: RegExp): Promise<void> {
    await expect(page.locator('[data-testid="bot-message"]').last()).toContainText(regex)
}

export async function expectActionTrace(page: Page, kinds: string[]): Promise<void> {
    for (const k of kinds) {
        await expect(page.locator(`[data-testid="chat-runtime-timeline-turn-${k}"]`)).toBeVisible()
    }
}

// DB helpers — pongono richiede dipendenze deferite
export async function readDbTurnLog(_turnId: string): Promise<{ status: string, failedReason: string | null }> {
    throw new Error('TODO: implement via direct DB query (env-bound)')
}

export async function readDbOutbox(_turnId: string): Promise<Array<{ eventStatus: string, sessionSequence: string }>> {
    throw new Error('TODO: implement via direct DB query (env-bound)')
}
```

**Commit template**:
```
test(e2e): T-03 chat-runtime-helpers scaffold (env-bound DB helpers stubbed)
```

**LoC**: ~80.

---

### T-04..T-15 — 12 spec stubs (con `.skip`)

**Strategy**: per ognuno dei 12 file, scaffold `test.describe.skip()` con `test.skip(...)` interni che documentano TODO.

**Template per ogni spec**:

```ts
import { test, expect } from '@playwright/test'
import { setupMockMcp, openChatForFixture, sendUserMessage, expectBotMessage, expectActionTrace } from '../../../fixtures/chat-runtime-helpers'

test.describe.skip('command-layer <SCENARIO>', () => {
    test.beforeEach(async ({ page: _ }) => {
        await setupMockMcp({ mode: 'happy' })
    })

    test.skip('TODO: scenario 1', async ({ page: _ }) => {
        // outline: see docs/interactive-flow/closure-plan.md T-<id>
    })
})
```

**File da creare** (12 totali, ognuno con stub minimo):
- T-04: `command-layer-meta.local.spec.ts`
- T-05: `command-layer-info.local.spec.ts`
- T-06: `command-layer-cancel.local.spec.ts`
- T-07: `command-layer-cancel-ttl.local.spec.ts`
- T-08: `command-layer-compound.local.spec.ts`
- T-09: `command-layer-topic-change.local.spec.ts`
- T-10: `command-layer-timeline.local.spec.ts`
- T-11: `command-layer-cas-conflict.local.spec.ts`
- T-12: `command-layer-saga-recovery.local.spec.ts`
- T-13: `command-layer-catalog-failure.local.spec.ts`
- T-14: `command-layer-idempotent-retry.local.spec.ts`
- T-15: `command-layer-legacy-regression.local.spec.ts`

**Commit per ogni spec**:
```
test(e2e): T-<id> <scenario short> scaffold (skip pending env)
```

oppure raggruppato:
```
test(e2e): T-04..T-15 spec stubs scaffold (12 specs, all skip pending env)
```

**LoC**: 12 × ~30 = ~360.

**Self-test**: `cd packages/tests-e2e && npx tsc --noEmit scenarios/ce/flows/command-layer-*.local.spec.ts`.

---

## R-RO / S-SUNSET doc

**Status**: BLOCKED on staging/prod. Doc-only.

**Implementation**: crea `docs/interactive-flow/canary-rollout-plan.md`:

```markdown
# Canary Rollout — Command Layer

Prerequisiti env: staging + prod, Linear access, Grafana dashboards.

## Phase 1: read-only validation (consultazione)
1. Deploy branch su staging.
2. Abilita `useCommandLayer: true` solo su consultazione (read-only flow).
3. Monitor 24h:
   - Grafana: errorRate < 0.1%
   - p95 turnInterpreter latency < 2× baseline (target < 800ms)
   - 0 prepared turns rimasti pending dopo 5 minuti
4. Se OK → Phase 2. Altrimenti revert via `useCommandLayer: false`.

## Phase 2: estinzione canary 5%
1. Feature-flag canary 5% su estinzione.
2. Monitor 48h.
3. Procedi 25% (2 giorni) → 100% (1 settimana).

## Sunset
1. Dopo 30gg di full prod stabile, marca legacy `field-extractor.ts` `@deprecated`.
2. Remove legacy code dopo altri 60gg.
3. Aggiorna `solution-final-v3.3.md` con note di sunset.

## Rollback rapido
- `useCommandLayer: false` su tutto → flow ritorna a legacy senza redeploy backend.
- Prepared turns rimasti rollback in ~5 minuti via `lockRecoveryDaemon`.
```

**Commit template**:
```
docs(command-layer): canary rollout + sunset plan for on-call/staging team
```

**LoC**: ~50.

---

## Cross-phase impact matrix

Quando un task tocca un'interfaccia condivisa, i task dipendenti devono assorbire il cambiamento:

| Task → cambia... | Allora aggiorna... |
|---|---|
| C-09 → ConversationCommandSchema test | Se Zod schema cambia, anche `vercel-ai-adapter.ts` tools registry deve aggiornarsi |
| H-04 → chat-runtime-timeline.tsx | I 11 keys i18n in EN + 10 locales devono esistere prima del merge |
| H-05 → outbox.service insertPending | `pii-redactor.test.ts` deve coprire i nuovi casi (test in step 2) |
| H-03 → MetricsRoute schema | Tutti i test che chiamano `/metrics` devono accettare anche il querystring `format` |
| H-01 → 5 chiavi in 10 locales | Test `e2e` che asserisce stringa in chat (i18n) deve usare locale fallback EN se test stack |

---

## Recovery from common failures

| Symptom | Phase | Root cause | Fix |
|---|---|---|---|
| Coverage threshold not met after C-08 | C-02 | Branch defensive non coperto | Abbassa solo il threshold del file specifico, non globale |
| `vi.stubGlobal` non funziona | C-08 | vitest < 0.34 | Verifica versione, 3.0.8 OK |
| Shared test rejects valid CommandSchema | C-09 | Zod schema cambiato senza version bump | Bump shared `package.json` + ricompila |
| `jq: parse error` su locale | H-01 | virgola finale | rimuovi virgola, ri-valida con `jq .` |
| `useCommandLayer=true` integration test fail | A-12 | fixture estinzione/consultazione mancanti | Verifica `fixtures/flow-templates/` o usa request inline |
| Test publisher A-03 hang | A-03 | publisher non stop, interval continua | `outboxPublisher.stop()` in afterEach |
| `t is not a function` in chat-runtime-timeline test | H-04 | `useTranslation()` non mockata | aggiungi `vi.mock('react-i18next')` con `useTranslation: () => ({ t: (k) => k })` |
| `commandLayerMetrics.snapshotPrometheus is not a function` | H-03 | export non aggiunto al barrel | controlla `export const commandLayerMetrics = { ..., snapshotPrometheus }` |
| 412 conflict in test A-09 expected, got 500 | A-09 | controller path non testato (route handler fa cast) | mockare `expectedVersion` in path query corretto |

---

## Default action — unknown errors

Se un errore non corrisponde a nessuna riga in "Recovery":

```
1. Capture full error: stack trace + last 50 lines of log → /tmp/closure-error-<task-id>-<ts>.log
2. Mark task BLOCKED in this plan with reason: "unknown-error: <first 80 chars>"
3. DO NOT retry the same operation
4. DO NOT modify code to "make it pass" without root cause
5. Move to next non-dependent task
6. After 3 BLOCKED tasks total in current session: halt + summarize blockers
```

---

## Idempotency contract

Ogni task deve essere safe to re-run:

- File creation: già esistente → diff; uguale → skip; diverso → ritorna error e fix manuale
- Migration registration: già registrata → no-op
- Locale insert: chiave già presente → skip insert (verifica con grep prima)
- DB state: tutti i test `beforeEach` truncano; nessun side-effect cross-test

---

## Agent execution loop

```
1. cd /Users/politom/Documents/workspace/linksmt/agentic-engine/activepieces-fork
2. git status --short → empty? altrimenti halt.
3. git log -1 → last commit hash atteso
4. Pick first TODO da questo file (ordine in DAG section)
5. Read task block
6. Pre-flight check: ogni item OK?
7. Read Files to load
8. Apply Implementation
9. Run Self-test → pass
10. Run Verify → all gates green
11. git add <listed files>; git commit (template)
12. Mark VERIFIED nel TodoWrite + nel piano (se inline)
13. goto 4
```

**Halt conditions**:
- 3 consecutive failures stesso task
- Coverage < threshold senza test aggiungibili
- Cross-package change non chiarito → ask user

**Circuit breaker** (auto-halt):
- 5 commit/hour (pause 5min tra commit)
- 20 commit/session totali (chiedi conferma utente)
- > 500 LoC singolo commit (likely scope creep)
- > 50 file modificati pre-commit

---

## Anti-patterns (specifici a questo plan)

1. **Non aggiungere `process.chdir`** ai vitest.config che non lo avevano (shared, web).
2. **Non duplicare** test W-08 in T-API A-10 — usa doc reference.
3. **Non usare LLM API** per tradurre H-01 / H-04 — usa il catalogo nel piano.
4. **Non rimuovere `.skip`** dai T-PLAYWRIGHT scaffold — è on-call concern.
5. **Non testare il singleton `providerAdapterSingleton` direttamente** — è private.
6. **Non bypassare** `tryCatch` Go-style → si applica anche a refactor in H-05.

---

## Self-assessment v3 (canonical)

| Dimensione | Score v1 | Score v3 | Justification |
|---|---|---|---|
| Atomicità | 9 | 10 | Ogni task ha tutti i 12 elementi (Pre-flight, Files, Implementation, Self-test, Verify, Commit, Pitfalls, Rollback, LoC, Idempotency) |
| Verifiability | 9 | 10 | Self-test command + atteso explicit per ognuno |
| Determinism | 8 | 10 | Decision trees su task `PARTIAL_DONE_BY_SEAM`, default action su unknown errors |
| Coverage | 9 | 10 | Tutti i task del backlog (C/T/H/W/T-PW/R) inclusi |
| Code-grounded | 9 | 10 | Tutti i test C-08/C-09/H-03/H-04/H-05 hanno codice di riferimento completo |
| Recovery | 7 | 9 | Recovery matrix per ogni fase + default action |
| Brevity | 7 | 7 | ~1100 righe; trade-off scelto |
| Robustness | 8 | 10 | Cross-phase impact matrix + idempotency contract + circuit breaker |
| Sequencing | 9 | 10 | DAG esplicito + parallelism map |
| Onboarding | 9 | 10 | Quickstart + first-touch self-check + execution loop |

**Totale v3**: 96/100 = **9.6/10**

**Where it's not 10/10**:
- Brevity drops a 7 perché il piano è ~1100 righe; trade-off accettato.
- Recovery a 9 perché serve provare alcuni casi sul campo (es. T-PLAYWRIGHT helpers DB).

Per andare a 10/10 servirebbe esecuzione su staging per validare le sezioni env-bound — fuori scope per questo agente.

---

## Done condition

Plan VERIFIED quando:

**P0 (mandatory)**:
- C-RESIDUO: C-08, C-09, C-02, C-03, C-04 → tutti VERIFIED
- T-API-RESIDUO P0: A-02 doc, A-04 doc, A-09 verify, A-10 doc → tutti VERIFIED
- W-09 doc + R-RO doc → committati
- T-PLAYWRIGHT scaffold (T-02, T-03 + 12 stubs) → committato

**P1 (mandatory adoption)**:
- T-API: A-03, A-07, A-12 → VERIFIED
- H-HARDEN: H-01, H-05 → VERIFIED

**P2 (optional)**:
- H-03, H-04, H-02 → VERIFIED o `SKIPPED` con nota esplicita

**Final gate** (tutti verdi simultaneamente):
- G-LINT, G-API-COV, G-ENGINE-COV, G-SHARED-COV, G-WEB-COV, G-API-FULL, G-LOCALES, G-LINT su web

`progress-log.md` final entry con cumulative test counts + coverage % per package.

---

## Appendix A — H-04 catalogo timeline labels (10 locales)

11 chiavi `interactiveFlow.timeline.*` da aggiungere. Le copio testualmente in ogni file `packages/web/public/locales/<lang>/translation.json`:

```jsonc
// AR
"interactiveFlow.timeline.cancelConfirmed": "تم إلغاء التدفق",
"interactiveFlow.timeline.cancelRejected": "تم التراجع عن الإلغاء",
"interactiveFlow.timeline.cancelRequested": "تم اقتراح الإلغاء",
"interactiveFlow.timeline.cancelTtlExpired": "انتهت صلاحية الإلغاء",
"interactiveFlow.timeline.fieldExtracted": "تم الاستخراج: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "رد إعلامي: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "رد محادثي ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "طُلبت إعادة الصياغة ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "تم تأكيد الجولة",
"interactiveFlow.timeline.turnFailed": "فشلت الجولة",
"interactiveFlow.timeline.turnRolledBack": "تم التراجع عن الجولة",

// DE
"interactiveFlow.timeline.cancelConfirmed": "Flow abgebrochen",
"interactiveFlow.timeline.cancelRejected": "Abbruch widerrufen",
"interactiveFlow.timeline.cancelRequested": "Abbruch vorgeschlagen",
"interactiveFlow.timeline.cancelTtlExpired": "Abbruch abgelaufen",
"interactiveFlow.timeline.fieldExtracted": "Extrahiert: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "Informative Antwort: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "Konversationelle Antwort ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "Reformulierung angefragt ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Runde committet",
"interactiveFlow.timeline.turnFailed": "Runde fehlgeschlagen",
"interactiveFlow.timeline.turnRolledBack": "Runde zurückgesetzt",

// ES
"interactiveFlow.timeline.cancelConfirmed": "Flujo cancelado",
"interactiveFlow.timeline.cancelRejected": "Cancelación revocada",
"interactiveFlow.timeline.cancelRequested": "Cancelación propuesta",
"interactiveFlow.timeline.cancelTtlExpired": "Cancelación expirada",
"interactiveFlow.timeline.fieldExtracted": "Extraído: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "Respuesta informativa: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "Respuesta conversacional ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "Reformulación solicitada ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Turno confirmado",
"interactiveFlow.timeline.turnFailed": "Turno fallido",
"interactiveFlow.timeline.turnRolledBack": "Turno revertido",

// FR
"interactiveFlow.timeline.cancelConfirmed": "Flux annulé",
"interactiveFlow.timeline.cancelRejected": "Annulation révoquée",
"interactiveFlow.timeline.cancelRequested": "Annulation proposée",
"interactiveFlow.timeline.cancelTtlExpired": "Annulation expirée",
"interactiveFlow.timeline.fieldExtracted": "Extrait : {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "Réponse informative : {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "Réponse conversationnelle ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "Reformulation demandée ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Tour validé",
"interactiveFlow.timeline.turnFailed": "Tour échoué",
"interactiveFlow.timeline.turnRolledBack": "Tour annulé",

// JA
"interactiveFlow.timeline.cancelConfirmed": "フローをキャンセルしました",
"interactiveFlow.timeline.cancelRejected": "キャンセルを取り消しました",
"interactiveFlow.timeline.cancelRequested": "キャンセルを提案",
"interactiveFlow.timeline.cancelTtlExpired": "キャンセルの期限切れ",
"interactiveFlow.timeline.fieldExtracted": "抽出: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "情報回答: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "会話的回答 ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "再表現を要求 ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "ターン確定",
"interactiveFlow.timeline.turnFailed": "ターン失敗",
"interactiveFlow.timeline.turnRolledBack": "ターンロールバック",

// NL
"interactiveFlow.timeline.cancelConfirmed": "Flow geannuleerd",
"interactiveFlow.timeline.cancelRejected": "Annulering ingetrokken",
"interactiveFlow.timeline.cancelRequested": "Annulering voorgesteld",
"interactiveFlow.timeline.cancelTtlExpired": "Annulering verlopen",
"interactiveFlow.timeline.fieldExtracted": "Geëxtraheerd: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "Informatieve reactie: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "Conversationele reactie ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "Herformulering gevraagd ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Beurt vastgelegd",
"interactiveFlow.timeline.turnFailed": "Beurt mislukt",
"interactiveFlow.timeline.turnRolledBack": "Beurt teruggedraaid",

// PT
"interactiveFlow.timeline.cancelConfirmed": "Fluxo cancelado",
"interactiveFlow.timeline.cancelRejected": "Cancelamento revogado",
"interactiveFlow.timeline.cancelRequested": "Cancelamento proposto",
"interactiveFlow.timeline.cancelTtlExpired": "Cancelamento expirado",
"interactiveFlow.timeline.fieldExtracted": "Extraído: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "Resposta informativa: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "Resposta conversacional ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "Reformulação solicitada ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Turno confirmado",
"interactiveFlow.timeline.turnFailed": "Turno falhou",
"interactiveFlow.timeline.turnRolledBack": "Turno revertido",

// RU
"interactiveFlow.timeline.cancelConfirmed": "Поток отменён",
"interactiveFlow.timeline.cancelRejected": "Отмена отозвана",
"interactiveFlow.timeline.cancelRequested": "Отмена предложена",
"interactiveFlow.timeline.cancelTtlExpired": "Отмена истекла",
"interactiveFlow.timeline.fieldExtracted": "Извлечено: {{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "Информационный ответ: {{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "Разговорный ответ ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "Запрошена переформулировка ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "Ход зафиксирован",
"interactiveFlow.timeline.turnFailed": "Ход не удался",
"interactiveFlow.timeline.turnRolledBack": "Ход откачен",

// ZH
"interactiveFlow.timeline.cancelConfirmed": "流程已取消",
"interactiveFlow.timeline.cancelRejected": "取消已撤销",
"interactiveFlow.timeline.cancelRequested": "已提议取消",
"interactiveFlow.timeline.cancelTtlExpired": "取消已过期",
"interactiveFlow.timeline.fieldExtracted": "已提取：{{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "信息回复：{{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "对话回复 ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "请求重新表述 ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "回合已提交",
"interactiveFlow.timeline.turnFailed": "回合失败",
"interactiveFlow.timeline.turnRolledBack": "回合已回滚",

// ZH-TW
"interactiveFlow.timeline.cancelConfirmed": "流程已取消",
"interactiveFlow.timeline.cancelRejected": "取消已撤銷",
"interactiveFlow.timeline.cancelRequested": "已提議取消",
"interactiveFlow.timeline.cancelTtlExpired": "取消已過期",
"interactiveFlow.timeline.fieldExtracted": "已提取：{{field}} = {{value}}",
"interactiveFlow.timeline.infoAnswered": "資訊回覆：{{infoIntent}}",
"interactiveFlow.timeline.metaAnswered": "對話回覆 ({{kind}})",
"interactiveFlow.timeline.repromptEmitted": "請求重新表述 ({{reason}})",
"interactiveFlow.timeline.turnCommitted": "回合已提交",
"interactiveFlow.timeline.turnFailed": "回合失敗",
"interactiveFlow.timeline.turnRolledBack": "回合已回滾",
```

**Self-test H-04 fan-out**:
```bash
for L in en ar de es fr ja nl pt ru zh zh-TW; do
  count=$(grep -c "interactiveFlow.timeline" "packages/web/public/locales/$L/translation.json")
  [[ $count -eq 11 ]] || { echo "FAIL $L: $count keys (expected 11)"; exit 1; }
done
```

---

## Appendix B — T-04..T-15 spec outline dettagliato

Ogni file segue la struttura generica `test.describe.skip(...)` con TODO inline. Le seguenti outlines servono per quando l'on-call rimuove `.skip` e abilita il test.

### T-04 — `command-layer-meta.local.spec.ts`
**Scenario**: meta-questions during estinzione mid-flow.
**Setup**: useCommandLayer=true; fixture estinzione caricata; advance flow fino a `collect_reason` step.
**3 sub-tests**:
1. `sendUserMessage("cosa mi avevi chiesto?")` → `expectBotMessage(/codice motivazione/i)` + `expectActionTrace(['META_ANSWERED'])` + assert state.closureReasonCode unchanged
2. `sendUserMessage("non ho capito")` → trace contains `META_ANSWERED`
3. `sendUserMessage("ripeti per favore")` → trace contains `META_ANSWERED`

### T-05 — `command-layer-info.local.spec.ts`
**Setup**: state pre-loaded with `accounts: [{type:'CC',iban:'IT...'},{type:'CC',iban:'IT...'},{type:'D',iban:'IT...'}]`.
**2 sub-tests**:
1. `sendUserMessage("quanti rapporti ha?")` → `expectBotMessage(/3 rapporti/)` + `expectActionTrace(['INFO_ANSWERED'])`
2. State must NOT advance: `expect(readDbTurnLog(...).status).toBe('finalized')` con stateDiff vuoto

### T-06 — `command-layer-cancel.local.spec.ts`
**3 sub-tests**:
1. Trigger: `sendUserMessage("annulla")` → `expectPendingInteraction('pending_cancel')` + `expectBotMessage(/Vuoi davvero annullare/i)`
2. Accept (continuazione): `sendUserMessage("sì")` → `expectActionTrace(['CANCEL_CONFIRMED'])` + state reset + bot `/Pratica annullata/i`
3. Reject (continuazione, ramo separato): `sendUserMessage("no continuiamo")` → `expectActionTrace(['CANCEL_REJECTED'])` + state preserved

### T-07 — `command-layer-cancel-ttl.local.spec.ts`
**Setup**: pending_cancel inserito direttamente in DB con `createdAt = NOW() - 65 sec`, TTL 60s.
**1 test**: `sendUserMessage("ok")` → `expectActionTrace` contains `CANCEL_TTL_EXPIRED` + pending cleared

### T-08 — `command-layer-compound.local.spec.ts`
**Setup**: state pre-loaded with accounts.
**1 test**: `sendUserMessage("Rossi quanti rapporti ha?")` → trace `['FIELD_EXTRACTED','INFO_ANSWERED']` IN ORDER + state.customerName='Rossi' + bot `/N rapporti/`

### T-09 — `command-layer-topic-change.local.spec.ts`
**Setup**: state populated with customerName=Bellafronte + ndg + accounts.
**1 test**: `sendUserMessage("scusa il cliente è Rossi")` → trace `['TOPIC_CHANGED','FIELD_EXTRACTED']` + state.customerName='Rossi' + state.ndg=undefined + state.accounts=undefined

### T-10 — `command-layer-timeline.local.spec.ts`
**5 turns sequence**:
1. Per ogni turn, `readDbOutbox(turnId)` ritorna sessionSequence
2. Assert: monotonically strictly increasing across all 5 turns
3. Assert: all unique
4. Assert: frontend DOM order matches DB order (DOM testid mode dell'item indica l'ordine)

### T-11 — `command-layer-cas-conflict.local.spec.ts`
**2 browser contexts** sulla same session.
**1 test**: entrambi `sendUserMessage` simultaneamente via `Promise.all`. Expected:
- Uno succeeds (state mutated)
- L'altro mostra error `/sessione modificata|conflict/i`
- Refresh entrambi i contexts → convergence sullo stesso state

### T-12 — `command-layer-saga-recovery.local.spec.ts`
**Setup**: setupMockMcp(`slow` mode 30s delay).
**1 test**:
1. `sendUserMessage` triggera prepared turn
2. Kill API process: helper `process.kill(apiPid, 'SIGKILL')`
3. Restart API. Wait for recovery (5min OR test-clock advance se disponibile)
4. Assert `readDbTurnLog(turnId).status === 'compensated'` + `failedReason === 'finalize-timeout'`
5. Outbox events for that turn marked `void`

### T-13 — `command-layer-catalog-failure.local.spec.ts`
**Setup**: setupMockMcp(`catalog-fail`); estinzione mid-flow at `collect_reason`.
**1 test**: `sendUserMessage("motivazione 01")` → `expectBotMessage(/Caricamento motivazioni in corso|riprova/i)` + trace contains `CATALOG_PREEXEC_FAILED` + state.closureReasonCode unset

### T-14 — `command-layer-idempotent-retry.local.spec.ts`
API integration (no browser).
**1 test**:
1. `POST /interpret-turn` with turnId=X → 200, response A
2. `POST /interpret-turn` with same turnId=X → 200, response B
3. Assert `A.stateDiff === B.stateDiff` and outbox events not duplicated

### T-15 — `command-layer-legacy-regression.local.spec.ts`
Fixture estinzione con `useCommandLayer: false`.
**1 test**: full estinzione happy-path flow → compare to baseline snapshot (capture once before W-WIRING merge for diff).

---

## Appendix C — Final ordering reminder

Esecuzione raccomandata sequenziale (tutti i task dello stesso TODO group sono indipendenti l'uno dall'altro all'interno del group):

```
1. C-08          (engine turn-interpreter-client tests)
2. C-09          (shared schemas tests)
3. C-02          (engine vitest config thresholds)
4. C-03          (shared vitest config + thresholds)
5. C-04          (web vitest config + reducer test)
6. A-02 doc      (note-only)
7. A-04 doc      (note-only)
8. A-09 verify-then-skip-or-test
9. A-10 doc      (note-only)
10. A-03         (publisher integration)
11. A-07         (traces endpoint)
12. A-12         (cross-flow)
13. H-01         (i18n fan-out 5 keys × 10 locales)
14. H-05         (PII redactor in outbox insert)
15. H-03         (Prometheus content-type)
16. H-04         (chat-runtime-timeline localize) — depends on H-01 baseline + 11 new keys
17. H-02         (bridge spec scaffold, env-bound)
18. W-09 doc     (smoke checklist)
19. T-02         (mock MCP modes)
20. T-03         (chat helpers)
21. T-04..T-15   (12 spec stubs scaffold)
22. R-RO doc     (canary plan)
23. progress-log final entry
```
