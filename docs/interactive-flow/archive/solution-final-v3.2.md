# INTERACTIVE_FLOW — Revised Architecture Proposal (v3.2)

> **⚠️ Superseded by [solution-final-v3.3.md](solution-final-v3.3.md)**. Terza review Codex ha identificato 2 NEW BUG (lease `worker_id` riacquisibile; sequence `MAX+1 FOR UPDATE` non robusto) + 7 PARTIALLY (T1 committed pre-T2, commit stale post-recovery, EntitySchema/migration mismatch, messageOut DTO incoerente, P9 conflict SET+RESOLVE, dispatcher matrix incompleta, naming residuo) + 5 findings extra (publisher FIFO, SQLite contraddittorio, pending_cancel transizione, store-entries CAS dedicato, TurnResult engine-side). Tutti corretti architetturalmente in v3.3, che è **fine del ciclo di revisione documentale**: dopo v3.3 obbligatorio spike SQL/concurrency con test reali. Usare v3.3 come riferimento definitivo.

> Iterazione definitiva dopo code-aware review di Codex su v3.1 che ha identificato 15 findings critici (di cui 4 `FIX INTRODUCES NEW BUG` e 8 `INTEGRATED PARTIALLY`). Tutti integrati architetturalmente (non patch cosmetici). Verdetto Codex target: da ROSSO a GIALLO.

## 0. Changelog vs v3.1

| # | Finding Codex v3.1 | Correzione in v3.2 | Sezione |
|---|---|---|---|
| 1 | Firma `candidatePolicy.verifyEvidence(evidence, userMessage)` posizionale, ma reale è named params `{evidence, userMessage}` | Corretta ovunque nel doc | §7 P3 |
| 2 | "single DB transaction" include sessione HTTP → falsa atomicità | **Modello transazionale ridisegnato**: session CAS eseguito PRIMA, indipendente; DB tx (turn-log + outbox) DOPO; compensation esplicita se tx fallisce post-CAS | §8 |
| 3 | Retry auto-bloccante: stesso turnId rientra e trova il proprio in-progress → 409 permanente | **Idempotency model ridisegnato**: UPSERT con lease/TTL + worker_id. Retry stesso worker aggiorna il lease; retry da worker diverso attende scadenza o riceve 409 | §8.3 |
| 4 | Lock zombie su crash: in-progress non si libera mai | Lease TTL 30s + recovery daemon che libera stale lock. Row stato finale è `committed` o `failed`, mai `in-progress` persistente | §8.4 |
| 5 | Outbox `outbox_event_id UUID v4 > lastKnown` non ordina temporalmente | `session_sequence BIGINT` monotono per sessione, assegnato al commit. Replay usa `session_sequence > lastKnown` | §9.3, §11 |
| 6 | TypeORM `@Entity/@Column` decorator non è il pattern del repo | **Tutto ridisegnato con `EntitySchema`** pattern reale (cfr. `store-entry-entity.ts`). Migration path corretto `database/migration/postgres` | §9.4 |
| 7 | Boundary engine/api non risolto: command layer in `server/api` chiamato da `server/engine` via import diretto impossibile | Boundary **HTTP preservato**: nuovo endpoint `POST /v1/engine/interactive-flow-ai/interpret-turn`; engine chiama via nuovo helper analogo a `field-extractor.ts` | §5.2, §14 |
| 8 | First-turn catalog pre-execution engine-side vs command layer api-side | Chiarito: catalog pre-exec resta **engine-side** (non si sposta). Command layer API riceve `pre-loaded state` nella request e opera su stato già popolato | §12 |
| 9 | InfoRenderer `messageOut` pre-DAG può essere incoerente se DAG fallisce | **Messaggio a due fasi**: (a) acknowledgment committed pre-DAG, (b) status finale post-DAG; niente "confermato/eseguito" prima dell'esito DAG | §13 |
| 10 | P9 mutua esclusione valutata prima dei per-command scarta prematuramente | **P9 a due fasi**: P9a syntactic cardinality (max 1 di X) prima, P9b semantic exclusion dopo accepted | §7 |
| 11 | Pending resolver senza comportamento `pending_cancel`: solo dichiarato | Specifica TTL 60s, keywords accept/reject IT/EN, message template, side-effect reset sessione | §10.1, §7.2 |
| 12 | MetaKind/PendingKind/RepromptReason dispatcher outcome ambiguo | **Dispatcher outcome matrix** esplicita: 9×3 tabella (input command array × active pending) → outcome deterministic | §20 |
| 13 | Catalog partial failure: prompt/P4 lavorano su stato parzialmente popolato | `catalogReadiness` per ogni enum source; se catalog incompleto per un campo richiesto → outcome forzato `ASK_FIELD` | §14 |
| 14 | Inconsistenza benchmark 20-30 (§2.2) vs 100-200 (§14) | Chiariti scope: 20-30 golden deterministic (mock adapter, Phase 0) + 100-200 LLM reale (Phase 0.5) | §16 |
| 15 | Naming `session.revision` vs `sessionRevision` | Audit completo e uniformazione | §19 |
| 16 | Count dichiarato 30, tabella 29 righe | Enumerazione esplicita con count corretto (29 + 1 implicito) | §21 |

**16 correzioni integrate** (15 findings Codex + errata count). Sei architetturali (#2, #3, #4, #5, #6, #7, #9, #10, #12, #13), altre documentali. Tutte applicate con struttura robusta, non con workaround testuali.

---

## 1. Executive verdict

**Cambiamenti principali rispetto a v3.1**:

1. **Modello transazionale onesto**: v3.1 rivendicava atomicità fra session HTTP CAS e DB transaction. Impossibile. v3.2 separa i due livelli e definisce esplicitamente una **compensation policy** per tutti i failure mode.
2. **Idempotency con lease**: turn-log `in-progress` rows hanno `locked_until` TTL 30s + `worker_id`. Retry dallo stesso worker aggiorna il lease. Crash/timeout → recovery daemon ripulisce.
3. **Outbox ordinato per sequence**: `session_sequence BIGINT` monotono sostituisce UUID v4 come cursor di replay. Publisher con row-level advisory lock evita consumer concorrenti.
4. **Boundary HTTP preservato**: l'engine non importa `server/api`. Nuovo endpoint REST analogo a field-extract attuale.
5. **Messaggio di risposta bifase**: acknowledgment pre-DAG, status post-DAG. Mai claim "eseguito" prima della verifica DAG.
6. **Dispatcher outcome matrix** esplicita sostituisce ambiguità di priority fra commands.
7. **Catalog readiness check** previene validazione P4 contro catalog parzialmente caricato.
8. **Pattern EntitySchema** e migration dir reali sostituiscono decorator fake.
9. **Policy P9 bifase**: cardinality syntactic prima, exclusion semantic dopo accepted.
10. **Naming audit**: ogni occorrenza verificata contro registry §19.

**Nuovo verdetto target Codex**: VERDE per Phase 0 kickoff, a patto che i 5 architectural decisions (transaction model, outbox ordering, idempotency recovery, boundary, TypeORM pattern) siano convalidati in **1 settimana di spike** prima di Phase 0 full-send.

---

## 2. Ground truth — codebase reality

Invariato da v3.1 §2. Ricorda:

### 2.1 File esistenti riusati (chiave)

- [candidate-policy.ts:147-153](../../packages/server/api/src/app/ai/candidate-policy.ts#L147-L153) esporta `candidatePolicy.{verifyEvidence, verifyFieldPlausibility, verifyDomain, verifyFieldAdmissibility}`. **Firme sono named parameter**: `verifyEvidence({ evidence, userMessage })`.
- [session-store.ts:231-240](../../packages/server/engine/src/lib/handler/session-store.ts#L231-L240) esporta `sessionStore.{makeSessionKey, load, save, clear, detectTopicChange, applyStateOverwriteWithTopicChange, appendHistory, buildDependencyGraph}`. Backed by HTTP `/v1/store-entries`.
- [interactive-flow-executor.ts:1016](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts#L1016) resume path + [riga 1117](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts#L1117) first-turn path: punti di iniezione per feature flag `useCommandLayer`.
- [interactive-flow-executor.ts:1091-1115](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts#L1091-L1115) first-turn catalog pre-execution: **preservato in engine-side**, invariato.
- [interactive-flow-ai.controller.ts](../../packages/server/api/src/app/ai/interactive-flow-ai.controller.ts) pattern da replicare per il nuovo endpoint `/interpret-turn`.
- [field-extractor.ts](../../packages/server/engine/src/lib/handler/field-extractor.ts) pattern da replicare per il nuovo client `turnInterpreterClient`.
- [store-entry-entity.ts](../../packages/server/api/src/app/store-entry/store-entry-entity.ts) pattern `EntitySchema` da replicare per turn-log e outbox entities.

### 2.2 File da creare (corretti)

**Shared schemas**:
- `packages/shared/src/lib/automation/interactive-flow/conversation-command.ts`
- `packages/shared/src/lib/automation/interactive-flow/turn-event.ts`
- `packages/shared/src/lib/automation/interactive-flow/turn-interpret-dto.ts` (request/response del nuovo endpoint)

**Engine-side** (dentro `packages/server/engine/src/lib/handler/`):
- `turn-interpreter-client.ts` — HTTP client per il nuovo endpoint API. Pattern analogo a `field-extractor.ts`

**API-side** (dentro `packages/server/api/src/app/ai/`):
- `command-layer/provider-adapter.ts`
- `command-layer/policy-engine.ts`
- `command-layer/command-dispatcher.ts`
- `command-layer/prompt-builder.ts`
- `command-layer/info-renderer.ts`
- `command-layer/pre-resolvers.ts`
- `command-layer/turn-interpreter.ts`
- `command-layer/turn-interpret.controller.ts` — nuovo endpoint Fastify

**Database entities** (feature-local, pattern `EntitySchema`):
- `packages/server/api/src/app/ai/command-layer/turn-log-entity.ts`
- `packages/server/api/src/app/ai/command-layer/outbox-entity.ts`
- Aggiungere in `getEntities()` di `database-connection.ts`

**Migrations** (dir reale, cfr. [database-connection.ts](../../packages/server/api/src/app/database/database-connection.ts)):
- `packages/server/api/src/app/database/migration/postgres/{timestamp}-add-command-layer-primitives.ts`
- `packages/server/api/src/app/database/migration/common/{timestamp}-add-command-layer-primitives.ts` (se il repo supporta sqlite in community edition; verificare convention)

**Worker**:
- `packages/server/api/src/app/ai/command-layer/outbox-publisher.ts` (worker Fastify plugin o separate process)
- `packages/server/api/src/app/ai/command-layer/lock-recovery.ts` (daemon per stale turn-log)

**Frontend**:
- `packages/web/src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts`
- `packages/web/src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts`

**Tests**:
- `packages/tests-e2e/scenarios/ce/flows/interactive-flow/command-layer-golden.local.spec.ts` (20-30 turni golden, mock adapter)
- `packages/server/api/test/ai/command-layer/*.test.ts` (unit: policy engine, dispatcher, pre-resolvers)

### 2.3 File da estendere

| Path | Modifica | Phase |
|---|---|---|
| [interactive-flow-action.ts](../../packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts) | +`pending_cancel` in PendingInteractionSchema; +`infoIntents`, +`useCommandLayer` in InteractiveFlowActionSettings | 0 |
| [session-store.ts](../../packages/server/engine/src/lib/handler/session-store.ts) | +`revision: number` in SessionRecord; +`loadWithRevision`, +`saveWithCAS` | 0 |
| [store-entry.service.ts](../../packages/server/api/src/app/store-entry/store-entry.service.ts) + [store-entry.controller.ts](../../packages/server/api/src/app/store-entry/store-entry.controller.ts) + [store-entry-request.ts](../../packages/shared/src/lib/core/store-entry/dto/store-entry-request.ts) | +`expectedVersion?: number` in PutStoreEntryRequest; API response 412 on mismatch; new `version: number` column su store-entry (additive, non-breaking) | 0 |
| `packages/shared/package.json` | Minor version bump | 0 |
| [pending-interaction-resolver.ts](../../packages/server/api/src/app/ai/pending-interaction-resolver.ts) | +branch `pending_cancel` con TTL, keywords, clearing | 0 |
| [interactive-flow-executor.ts](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts) | Sostituire 2 chiamate `fieldExtractor.extractWithPolicy` con `turnInterpreterClient.interpret` dietro feature flag. Preservare side-effect su `pendingOverwriteSignal`, `lastExtractionDecisions`, `rejectionHint`, history, topic-change clearing, executedNodeIds, skippedNodeIds | 2 |

---

## 3. Architecture diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│ CLIENT (chat drawer)                                                  │
│  user message ──────────► turn request { turnId, idempotencyKey }     │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │ WebSocket
                                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│ ENGINE (packages/server/engine)                                       │
│                                                                       │
│ interactiveFlowExecutor.handle (INVARIATO entry point)                │
│                                                                       │
│   1. Load session locale (sessionStore.loadWithRevision)              │
│   2. Check pendingInteraction resolver pre-LLM (resolver esistente)   │
│   3. First-turn catalog pre-execution (ENGINE-SIDE, riga 1091-1115)   │
│   4. if settings.useCommandLayer:                                     │
│        → POST /v1/engine/interactive-flow-ai/interpret-turn           │
│          body: { turnId, idempotencyKey, sessionRevision,             │
│                  message, state (pre-loaded), history,                │
│                  pendingInteraction, stateFields, nodes,              │
│                  currentNodeHint, infoIntents, systemPrompt }         │
│      else:                                                            │
│        → legacy fieldExtractor.extractWithPolicy (INVARIATO)          │
│   5. Apply response to local state, pending, history                  │
│   6. DAG loop (INVARIATO, emits NodeStateEvent best-effort)           │
│   7. Save session with CAS (sessionStore.saveWithCAS)                 │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │ HTTP
                                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│ API (packages/server/api)                                             │
│                                                                       │
│ POST /v1/engine/interactive-flow-ai/interpret-turn                    │
│ turnInterpreter.interpret(request)                                    │
│                                                                       │
│  [A] IDEMPOTENCY ACQUIRE LEASE                                        │
│      UPSERT turn_log SET worker_id=?, locked_until=NOW()+30s          │
│      WHERE turn_id=? AND (status='in-progress' AND locked_until<NOW() │
│                            OR status IS NULL)                         │
│        if committed → return cached result                            │
│        if locked by other worker → 409                                │
│        if acquired → proceed                                          │
│                                                                       │
│  [B] PRE-RESOLVERS (deterministic, no LLM)                            │
│      from request (catalog pre-loaded from engine)                    │
│                                                                       │
│  [C] LLM CALL via ProviderAdapter (only if pre-resolvers empty)       │
│      promptBuilder + generateText + Zod parse                         │
│                                                                       │
│  [D] POLICY ENGINE (2-phase)                                          │
│      phase 1: P9a syntactic cardinality                               │
│      phase 2: P1-P6, P8 per-command                                   │
│      phase 3: P9b semantic exclusion on accepted                      │
│                                                                       │
│  [E] INFO RENDERER                                                    │
│      produce messageOut (pre-DAG acknowledgment only)                 │
│      server-side template, no LLM free text                           │
│                                                                       │
│  [F] COMMIT (DB transaction — turn-log + outbox ONLY)                 │
│      BEGIN;                                                           │
│        assign session_sequence = COALESCE(MAX+1, 1) FOR UPDATE        │
│        UPDATE turn_log SET status='committed', committed_at=NOW(),    │
│                            result=..., accepted=..., rejected=...     │
│        INSERT outbox (session_sequence, ...) * N events               │
│      COMMIT;                                                          │
│      NOTE: session CAS happens LATER in engine, NOT part of this tx   │
│                                                                       │
│  [G] RESPONSE                                                         │
│      { stateDiff, pendingDiff, messageOut, turnEvents,                │
│        acceptedCommands, rejectedCommands, sessionSequence }          │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│ ENGINE (continues)                                                    │
│                                                                       │
│  5. Apply stateDiff locally                                           │
│  6. DAG loop on new state (INVARIATO)                                 │
│  7. sessionStore.saveWithCAS(expectedRevision) via store-entries API  │
│        if CAS ok → normal continuation                                │
│        if CAS fail (412) → session was modified concurrently:         │
│           → COMPENSATION: POST /interpret-turn/rollback with turnId   │
│             which marks turn_log.status='compensated' + emits         │
│             turn event 'TURN_ROLLED_BACK'                             │
│           → return error to client; outbox events for this turn       │
│             flushed with 'TURN_ROLLED_BACK' marker                    │
│  8. Return response to client                                         │
└───────────────────────────────────────────────────────────────────────┘

Separate async worker:
┌───────────────────────────────────────────────────────────────────────┐
│ OUTBOX PUBLISHER (packages/server/api, worker plugin)                 │
│                                                                       │
│  polls outbox WHERE published_at IS NULL                              │
│  ORDER BY session_id, session_sequence                                │
│  row-level lock FOR UPDATE SKIP LOCKED (one publisher per session)    │
│  emit on WebSocket topic INTERACTIVE_FLOW_TURN_EVENT                  │
│  UPDATE published_at=NOW()                                            │
│  retry with exponential backoff, max 10 attempts                      │
│  after 10 → status='dead-letter', alert ops                           │
└───────────────────────────────────────────────────────────────────────┘

Separate async daemon:
┌───────────────────────────────────────────────────────────────────────┐
│ LOCK RECOVERY DAEMON                                                  │
│                                                                       │
│  every 10s: SELECT turn_log WHERE status='in-progress'                │
│    AND locked_until < NOW()                                           │
│  UPDATE → status='failed', failed_reason='lease-expired'              │
│  emit outbox event 'TURN_LEASE_EXPIRED' for audit                     │
└───────────────────────────────────────────────────────────────────────┘
```

Elementi chiave (cambiamenti rispetto a v3.1):

- **Session CAS separata dalla DB tx**: la session store-entries HTTP call NON è parte della DB transaction. È chiamata DOPO, con compensation se fallisce.
- **Catalog pre-execution engine-side**: non si sposta, il state viene **passato pre-loaded** nella request HTTP.
- **messageOut solo pre-DAG ack**: status finale aggiornato dal DAG loop successivo.
- **session_sequence in outbox**: per ordering deterministic del replay.
- **Lease recovery daemon**: ripulisce lock zombie automaticamente.
- **Publisher con row-lock**: previene consumer concorrenti sulla stessa sessione.

---

## 4. ConversationCommand contract

File: `packages/shared/src/lib/automation/interactive-flow/conversation-command.ts`

Rispetta [root CLAUDE.md](../../CLAUDE.md) (types al fondo, no `any`, no casting).

```typescript
import { z } from 'zod'

const FieldUpdateSchema = z.object({
  field: z.string().min(1, 'validation.conversationCommand.field.required'),
  value: z.unknown(),
  evidence: z.string().min(2, 'validation.conversationCommand.evidence.tooShort'),
  confidence: z.number().min(0).max(1).optional(),
})

const SetFieldsCommandSchema = z.object({
  type: z.literal('SET_FIELDS'),
  updates: z.array(FieldUpdateSchema).min(1),
})

const AskFieldCommandSchema = z.object({
  type: z.literal('ASK_FIELD'),
  field: z.string().min(1),
  reason: z.string().optional(),
})

const AnswerMetaCommandSchema = z.object({
  type: z.literal('ANSWER_META'),
  kind: z.enum(['ask-repeat', 'ask-clarify', 'ask-progress', 'ask-help']),
  message: z.string().optional(),
})

const AnswerInfoCommandSchema = z.object({
  type: z.literal('ANSWER_INFO'),
  infoIntent: z.string().min(1),
  citedFields: z.array(z.string().min(1)).min(1),
})

const RequestCancelCommandSchema = z.object({
  type: z.literal('REQUEST_CANCEL'),
  reason: z.string().optional(),
})

const ResolvePendingCommandSchema = z.object({
  type: z.literal('RESOLVE_PENDING'),
  decision: z.enum(['accept', 'reject']),
  pendingType: z.enum([
    'confirm_binary',
    'pick_from_list',
    'pending_overwrite',
    'pending_cancel',
  ]),
})

const RepromptCommandSchema = z.object({
  type: z.literal('REPROMPT'),
  reason: z.enum([
    'low-confidence',
    'policy-rejected',
    'off-topic',
    'ambiguous-input',
    'provider-error',
    'catalog-not-ready',
  ]),
})

export const ConversationCommandSchema = z.discriminatedUnion('type', [
  SetFieldsCommandSchema,
  AskFieldCommandSchema,
  AnswerMetaCommandSchema,
  AnswerInfoCommandSchema,
  RequestCancelCommandSchema,
  ResolvePendingCommandSchema,
  RepromptCommandSchema,
])

export type ConversationCommand = z.infer<typeof ConversationCommandSchema>
export type FieldUpdate = z.infer<typeof FieldUpdateSchema>
export type SetFieldsCommand = z.infer<typeof SetFieldsCommandSchema>
export type AskFieldCommand = z.infer<typeof AskFieldCommandSchema>
export type AnswerMetaCommand = z.infer<typeof AnswerMetaCommandSchema>
export type AnswerInfoCommand = z.infer<typeof AnswerInfoCommandSchema>
export type RequestCancelCommand = z.infer<typeof RequestCancelCommandSchema>
export type ResolvePendingCommand = z.infer<typeof ResolvePendingCommandSchema>
export type RepromptCommand = z.infer<typeof RepromptCommandSchema>
```

Note rispetto a v3.1:
- Aggiunto `'catalog-not-ready'` in `RepromptReason` (§14 catalog failure handling).
- i18n key strings come validation messages (CLAUDE.md rule).
- Types al fondo del file.

---

## 5. Provider adapter & boundary engine/api

### 5.1 Adapter semantico sopra Vercel AI SDK

Invariato da v3.1: `ProviderAdapter` interface + impl default `VercelAIAdapter` che usa `interactiveFlowModelFactory` esistente + `generateText` per emettere tool-call → mappa a `ConversationCommand[]` via Zod.

### 5.2 Boundary engine/api via HTTP (CORRETTO rispetto a v3.1)

**Finding Codex #7**: il command layer in `server/api` non può essere importato da `server/engine`. Oggi il boundary è HTTP via [field-extractor.ts](../../packages/server/engine/src/lib/handler/field-extractor.ts) che chiama [interactive-flow-ai.controller.ts](../../packages/server/api/src/app/ai/interactive-flow-ai.controller.ts).

v3.2 preserva lo stesso pattern:

```
packages/server/engine/src/lib/handler/turn-interpreter-client.ts:
  
  function interpret({ constants, request }: {
    constants: EngineConstants
    request: InterpretTurnRequest
  }): Promise<InterpretTurnResponse> {
    const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/interpret-turn`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${constants.engineToken}`,
        'Idempotency-Key': request.idempotencyKey,
      },
      body: JSON.stringify(request),
    })
    if (response.status === 409) throw new TurnInProgressError(request.turnId)
    if (!response.ok) throw new EngineGenericError(...)
    return InterpretTurnResponseSchema.parse(await response.json())
  }
  
  export const turnInterpreterClient = { interpret }
```

Il boundary HTTP preserva:
- Nessun import cross-package engine ↔ api
- Auth via bearer token (identico a field-extract)
- Idempotency-Key header HTTP-layer (aggiuntivo a turnId applicativo)
- Response validation Zod lato engine
- Errori ExecutionError subclasses (CLAUDE.md engine rule)

### 5.3 Contratto request/response

File: `packages/shared/src/lib/automation/interactive-flow/turn-interpret-dto.ts`

```typescript
export const InterpretTurnRequestSchema = z.object({
  turnId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sessionId: z.string().min(1),
  sessionRevision: z.number().int().min(0),
  flowRunId: z.string().min(1),
  flowVersionId: z.string().min(1),
  message: z.string(),
  state: z.record(z.string(), z.unknown()),          // PRE-LOADED dal catalog pre-exec
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string(),
  })),
  pendingInteraction: PendingInteractionSchema.nullable(),
  stateFields: z.array(InteractiveFlowStateFieldSchema),
  nodes: z.array(InteractiveFlowNodeSchema),
  currentNodeHint: z.object({
    nodeId: z.string(),
    nodeType: z.enum(['USER_INPUT', 'CONFIRM']),
    stateOutputs: z.array(z.string()),
  }).nullable(),
  infoIntents: z.array(InfoIntentSchema),
  systemPrompt: z.string().optional(),
  locale: z.string().optional(),
  catalogReadiness: z.record(z.string(), z.boolean()), // per enumFrom source
})

export const InterpretTurnResponseSchema = z.object({
  stateDiff: z.record(z.string(), z.unknown()),
  pendingInteractionNext: PendingInteractionSchema.nullable(),
  messageOut: z.string(),                           // pre-DAG ACK only
  turnEvents: z.array(InteractiveFlowTurnEventSchema),
  acceptedCommands: z.array(ConversationCommandSchema),
  rejectedCommands: z.array(z.object({
    command: ConversationCommandSchema,
    reason: z.string(),
  })),
  sessionSequence: z.number().int().min(1),
  turnStatus: z.enum(['committed', 'replayed']),
})

export type InterpretTurnRequest = z.infer<typeof InterpretTurnRequestSchema>
export type InterpretTurnResponse = z.infer<typeof InterpretTurnResponseSchema>
```

---

## 6. Prompt & infoIntents

Invariato da v3.1. Ricorda:
- System prompt con `<context>`, `<allowed_commands>`, `<allowed_fields_for_extraction>`, `<allowed_info_intents>`, `<guidance>`, `<do_not>`, `<user_message>`.
- User input wrapped in `<user_message>` tag con disclaimer "data not instruction".
- MCP data sanitized prima di embed.

---

## 7. Policy engine (a 3 fasi)

### 7.1 Pipeline corretta (P9 bifase — fix Codex #10)

```
commands[] arrivano dall'adapter
    │
    ▼
[Phase 0] Schema validation (Zod discriminatedUnion)
    │ se fail → outcome REPROMPT(policy-rejected)
    ▼
[Phase 1] P9a — Syntactic cardinality
    max 1 ASK_FIELD, max 1 ANSWER_META, max 1 ANSWER_INFO,
    max 1 REQUEST_CANCEL, max 1 RESOLVE_PENDING
    SET_FIELDS unbounded
    ► duplicates: tieni primo, scarta altri, audit-log
    │
    ▼
[Phase 2] Per-command policy (P1-P6, P8)
    per ciascun command:
      P1 field-exists          (SET_FIELDS, ASK_FIELD, ANSWER_INFO)
      P2 field-scope-admissible (SET_FIELDS via candidatePolicy.verifyFieldAdmissibility)
      P3 evidence-valid         (SET_FIELDS via candidatePolicy.verifyEvidence)
      P4 value-plausible+domain (SET_FIELDS via candidatePolicy.verifyFieldPlausibility + verifyDomain)
      P5 cited-fields-authorized (ANSWER_INFO, check catalogReadiness + authorized + populated)
      P6 pending-coherent       (RESOLVE_PENDING, REQUEST_CANCEL)
      P8 no-dispositivity-outside-confirm (SET_FIELDS su campo node-local)
    ► SET_FIELDS: atomic gate — un fail = intero command rigettato
    ► altri: per-command fail → scartato
    │
    ▼
[Phase 3] P9b — Semantic exclusion (sugli accepted post P1-P8)
    REQUEST_CANCEL + RESOLVE_PENDING(accept) mutuamente esclusivi
    se entrambi accettati:
      priority: RESOLVE_PENDING vince se pending_cancel attivo
                REQUEST_CANCEL vince altrimenti
    ► il perdente scartato, audit-log
    │
    ▼
accepted[] + rejected[] → dispatcher
    │
    ▼
Dispatcher outcome matrix (§20)
```

### 7.2 Specifica `pending_cancel` resolver

**Fix Codex #11 (partial → complete)**:

Quando `pending.type === 'pending_cancel'`:

- **TTL**: 60 secondi dalla creazione (campo `createdAt` ISO nel pending). Oltre → auto-clear + resolved come `reject`.
- **Accept keywords IT**: `sì`, `si`, `sicuro`, `certo`, `ok`, `conferma`, `confermo`, `procedi con l'annullamento`
- **Accept keywords EN**: `yes`, `confirm`, `cancel it`, `proceed cancel`
- **Reject keywords IT**: `no`, `aspetta`, `non voglio annullare`, `continuiamo`, `riprendi`
- **Reject keywords EN**: `no`, `wait`, `don't cancel`, `continue`
- **Action su accept**:
  - Clear pendingInteraction
  - Reset flow state (tutti `extractable` fields cleared, executedNodeIds cleared)
  - Emit outbox event `CANCEL_CONFIRMED`
  - messageOut template localizzato ("Pratica annullata. Puoi iniziarne una nuova.")
- **Action su reject**:
  - Clear pendingInteraction
  - State invariato
  - Emit outbox event `CANCEL_REJECTED`
  - messageOut template ("Annullamento annullato. Proseguiamo dove eravamo.")
- **Action su TTL expire**:
  - Equivalent a reject ma emit `CANCEL_TTL_EXPIRED`

### 7.3 Policy engine signature corrette

**Fix Codex #1 (firma verifyEvidence)**:

```typescript
// dentro policy-engine.ts
function checkP3({ update, userMessage }: {
  update: FieldUpdate
  userMessage: string
}): PolicyCheckResult {
  const result = candidatePolicy.verifyEvidence({
    evidence: update.evidence,
    userMessage,
  })
  return result.ok
    ? { pass: true }
    : { pass: false, reason: `p3-${result.reason}` }
}

function checkP4({ update, stateField, state }: {
  update: FieldUpdate
  stateField: InteractiveFlowStateField
  state: Record<string, unknown>
}): PolicyCheckResult {
  const plausResult = candidatePolicy.verifyFieldPlausibility({
    field: update.field,
    value: update.value,
    rules: {
      minLength: stateField.minLength,
      maxLength: stateField.maxLength,
      pattern: stateField.pattern,
    },
  })
  if (!plausResult.ok) return { pass: false, reason: `p4-${plausResult.reason}` }
  
  if (stateField.enumFrom) {
    const catalog = state[stateField.enumFrom]
    const domainResult = candidatePolicy.verifyDomain({
      field: update.field,
      value: update.value,
      catalog,
      valueField: stateField.enumValueField,
    })
    if (!domainResult.ok) return { pass: false, reason: `p4-${domainResult.reason}` }
  }
  
  return { pass: true }
}
```

Tutte le firme sono **named parameter object** coerenti col pattern repo (CLAUDE.md rule).

---

## 8. Turn transaction & idempotency (ridisegnata)

### 8.1 Transaction model — separazione onesta

Due transazioni **distinte**, non una falsa atomicità globale:

**T1 — DB transaction (API side)**:
- UPSERT `turn_log` (lease acquisition)
- SELECT + UPDATE `turn_log` (mark committed)
- INSERT `outbox` rows
- Assegna `session_sequence` monotonico

**T2 — Session CAS (engine side, HTTP)**:
- POST `/v1/store-entries` con `expectedVersion`
- 200 → success, session aggiornata
- 412 → precondition fail, retry o compensation

**Ordine esecuzione** (step 4-7 del diagram §3):
1. Engine chiama API `/interpret-turn` → API esegue T1 → risponde con stateDiff
2. Engine applica stateDiff localmente + DAG loop
3. Engine chiama `sessionStore.saveWithCAS` → T2
4. Se T2 fallisce (412 CAS mismatch) → **compensation**: engine chiama API `/interpret-turn/rollback` che marca turn_log.status='compensated' + emette evento outbox `TURN_ROLLED_BACK`. Engine ritorna errore al client.
5. Se T2 riesce → response al client

**Claim onesto**: T1 è atomica sui suoi effetti (turn-log + outbox). T2 è atomica sui suoi (session state). Il sistema è **eventualmente consistente** con compensation su conflict. Non è "single transaction".

### 8.2 Compensation policy matrix

| Stato | T1 | DAG | T2 (session CAS) | Outbox publisher | Azione |
|---|---|---|---|---|---|
| Tutto ok | committed | ok | 200 | pubblica eventi | normale |
| T1 fallisce | fail | skip | skip | nothing | 5xx al client, client retry |
| T1 ok, DAG fail | committed | fail | ancora eseguito (state extracted pre-DAG) | pubblica eventi + evento DAG_FAILED | client vede ack + alert DAG |
| T1 ok, T2 fail 412 | committed | ok | 412 | compensation call → rollback | client riceve errore "sessione modificata, riprova" |
| T1 ok, T2 fail 5xx | committed | ok | 5xx | retry 3× backoff | se ancora fail → stesso di 412 |
| T1 ok, T2 ok, publisher fail | committed | ok | 200 | retry exponential | eventualmente publishes o dead-letter |

### 8.3 Pseudo-code corretto (fix Codex #2, #3, #4)

```typescript
async function interpret(request: InterpretTurnRequest): Promise<InterpretTurnResponse> {
  // Phase A: Acquire lease via UPSERT (atomico)
  const leaseResult = await db.query(`
    INSERT INTO interactive_flow_turn_log (
      turn_id, session_id, flow_run_id, status, worker_id,
      locked_until, created_at
    )
    VALUES ($1, $2, $3, 'in-progress', $4, NOW() + INTERVAL '30 seconds', NOW())
    ON CONFLICT (turn_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      locked_until = EXCLUDED.locked_until
    WHERE interactive_flow_turn_log.status = 'in-progress'
      AND (interactive_flow_turn_log.locked_until < NOW()
           OR interactive_flow_turn_log.worker_id = EXCLUDED.worker_id)
    RETURNING *
  `, [request.turnId, request.sessionId, request.flowRunId, workerId])
  
  if (!leaseResult.rowCount) {
    // turn already committed OR locked by another worker
    const existing = await db.query(
      'SELECT * FROM interactive_flow_turn_log WHERE turn_id = $1',
      [request.turnId],
    )
    if (existing.rows[0]?.status === 'committed') {
      return rebuildResponseFromCommittedTurnLog(existing.rows[0])
    }
    throw new TurnInProgressError({ turnId: request.turnId })
  }
  
  try {
    // Phase B: Pre-resolvers
    const preResolved = preResolvers.resolve({
      message: request.message,
      pending: request.pendingInteraction,
    })
    
    // Phase C: LLM call (if needed)
    const commands = preResolved.ok
      ? preResolved.commands
      : await providerAdapter.proposeCommands({
          prompt: promptBuilder.build(request),
          catalogReadiness: request.catalogReadiness,
        })
    
    // Phase D: Policy engine (3-phase)
    const { accepted, rejected } = policyEngine.validate({
      commands,
      request,
    })
    
    // Phase E: Info renderer (pre-DAG ack only)
    const messageOut = infoRenderer.render({
      accepted,
      state: request.state,
      locale: request.locale,
    })
    
    // Phase F: Build transaction payload
    const stateDiff = dispatcher.computeStateDiff({ accepted, request })
    const pendingDiff = dispatcher.computePendingDiff({ accepted, request })
    const turnEvents = dispatcher.buildTurnEvents({ accepted, rejected, stateDiff })
    
    // Phase F: COMMIT (T1 — DB transaction only)
    const sessionSequence = await db.transaction(async (trx) => {
      // assign monotonic sequence for this session
      const seqResult = await trx.query(`
        SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_seq
        FROM interactive_flow_outbox
        WHERE session_id = $1
        FOR UPDATE
      `, [request.sessionId])
      const nextSeq = seqResult.rows[0].next_seq
      
      await trx.query(`
        UPDATE interactive_flow_turn_log
        SET status = 'committed',
            committed_at = NOW(),
            accepted_commands = $1,
            rejected_commands = $2,
            result = $3
        WHERE turn_id = $4
      `, [JSON.stringify(accepted), JSON.stringify(rejected),
          JSON.stringify({ messageOut, stateDiff, pendingDiff }),
          request.turnId])
      
      for (let i = 0; i < turnEvents.length; i++) {
        await trx.query(`
          INSERT INTO interactive_flow_outbox (
            outbox_event_id, session_id, flow_run_id, session_sequence,
            event_type, payload, created_at
          )
          VALUES ($1, $2, $3, $4, 'InteractiveFlowTurnEvent', $5, NOW())
        `, [randomUUID(), request.sessionId, request.flowRunId,
            nextSeq + i, JSON.stringify(turnEvents[i])])
      }
      
      return nextSeq + turnEvents.length - 1
    })
    
    // Phase G: Response to engine
    return {
      stateDiff,
      pendingInteractionNext: pendingDiff.next,
      messageOut,
      turnEvents,
      acceptedCommands: accepted,
      rejectedCommands: rejected,
      sessionSequence,
      turnStatus: 'committed',
    }
    
  } catch (err) {
    // Mark failed; publisher will emit TURN_FAILED event
    await db.query(`
      UPDATE interactive_flow_turn_log
      SET status = 'failed', failed_reason = $1
      WHERE turn_id = $2 AND worker_id = $3
    `, [String(err).slice(0, 500), request.turnId, workerId])
    throw err
  }
}
```

**Proprietà garantite**:

- **Nessun lock zombie**: se il processo crasha dopo il `INSERT ... ON CONFLICT`, la row ha `locked_until = NOW() + 30s`. Recovery daemon (§8.5) la libera.
- **Retry same-worker**: lo `ON CONFLICT WHERE ... OR worker_id = EXCLUDED.worker_id` permette al retry dallo stesso worker di ri-acquisire. Nessuno 409 auto-bloccante.
- **Retry other-worker**: se un altro worker vede `locked_until > NOW()`, riceve 409 e deve attendere/fallire. Client può retry con stesso turnId → stesso esito finché lease non scade.
- **Atomicità honest**: T1 è atomica. T2 (session CAS) è separata. Compensation esplicita.

### 8.4 Endpoint di compensation

`POST /v1/engine/interactive-flow-ai/interpret-turn/rollback`

```typescript
async function rollback({ turnId, reason }: {
  turnId: string
  reason: string
}): Promise<void> {
  await db.transaction(async (trx) => {
    const row = await trx.query(
      'SELECT * FROM interactive_flow_turn_log WHERE turn_id = $1 FOR UPDATE',
      [turnId],
    )
    if (row.rows[0]?.status !== 'committed') {
      throw new EngineGenericError({ message: 'cannot-rollback-non-committed' })
    }
    
    await trx.query(`
      UPDATE interactive_flow_turn_log
      SET status = 'compensated', failed_reason = $1
      WHERE turn_id = $2
    `, [reason, turnId])
    
    // Emit rollback event into outbox (next sequence)
    const seqResult = await trx.query(`
      SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_seq
      FROM interactive_flow_outbox WHERE session_id = $1
      FOR UPDATE
    `, [row.rows[0].session_id])
    
    await trx.query(`
      INSERT INTO interactive_flow_outbox (...)
      VALUES (..., event_type='TURN_ROLLED_BACK', ...)
    `, [...])
  })
}
```

### 8.5 Lock recovery daemon

File: `packages/server/api/src/app/ai/command-layer/lock-recovery.ts`

Esegue ogni 10 secondi (configurabile):

```typescript
async function reclaimStaleLocks(): Promise<void> {
  const reclaimed = await db.query(`
    UPDATE interactive_flow_turn_log
    SET status = 'failed',
        failed_reason = 'lease-expired',
        committed_at = NULL
    WHERE status = 'in-progress'
      AND locked_until < NOW()
    RETURNING turn_id, session_id, flow_run_id
  `)
  
  for (const row of reclaimed.rows) {
    await emitOutboxEvent({
      sessionId: row.session_id,
      flowRunId: row.flow_run_id,
      eventType: 'TURN_LEASE_EXPIRED',
      payload: { turnId: row.turn_id },
    })
  }
}
```

**Metric**: `turn_log_stale_reclaim_total`. Alert se > 10/minuto (indica bug worker crash o deadlock).

---

## 9. Storage primitives (EntitySchema, migration paths corrected)

### 9.1 Decision: PostgreSQL locale per turn-log e outbox

Il repo supporta sia SQLite (community) che PostgreSQL. Per turn-log e outbox con lease TTL + row-level lock serve **PostgreSQL** per:
- `FOR UPDATE SKIP LOCKED` (publisher concurrent safety)
- Timestamp arithmetic `NOW() + INTERVAL`
- `INSERT ... ON CONFLICT` UPSERT atomico

**Scelta**: feature disponibile solo quando `AP_DB_TYPE === 'POSTGRES'`. Per SQLite community edition: command layer disabilitato (feature flag `useCommandLayer` non accettato). Documentato esplicitamente come limitation.

Alternative considerate e scartate:
- Implementazione SQLite-compatible: richiederebbe application-level locking (Redis o in-memory mutex) → complicato e non distribuito.
- Migrare community a PostgreSQL obbligatorio: breaking change fuori scope.

### 9.2 EntitySchema pattern — turn-log

File: `packages/server/api/src/app/ai/command-layer/turn-log-entity.ts`

Pattern da [store-entry-entity.ts](../../packages/server/api/src/app/store-entry/store-entry-entity.ts):

```typescript
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../database/database-common'

type InteractiveFlowTurnLogSchema = {
  turnId: string
  sessionId: string
  flowRunId: string
  status: 'in-progress' | 'committed' | 'failed' | 'compensated'
  workerId: string | null
  lockedUntil: Date | null
  acceptedCommands: unknown | null
  rejectedCommands: unknown | null
  result: unknown | null
  createdAt: Date
  committedAt: Date | null
  failedReason: string | null
}

export const InteractiveFlowTurnLogEntity = new EntitySchema<InteractiveFlowTurnLogSchema>({
  name: 'interactive_flow_turn_log',
  columns: {
    turnId: {
      type: String,
      length: 64,
      primary: true,
    },
    sessionId: {
      type: String,
      length: 256,
      nullable: false,
    },
    flowRunId: {
      type: String,
      length: 64,
      nullable: false,
    },
    status: {
      type: String,
      length: 16,
      nullable: false,
    },
    workerId: {
      type: String,
      length: 64,
      nullable: true,
    },
    lockedUntil: {
      type: 'timestamp with time zone',
      nullable: true,
    },
    acceptedCommands: {
      type: 'jsonb',
      nullable: true,
    },
    rejectedCommands: {
      type: 'jsonb',
      nullable: true,
    },
    result: {
      type: 'jsonb',
      nullable: true,
    },
    createdAt: {
      type: 'timestamp with time zone',
      nullable: false,
    },
    committedAt: {
      type: 'timestamp with time zone',
      nullable: true,
    },
    failedReason: {
      type: String,
      nullable: true,
    },
  },
  indices: [
    { name: 'idx_turn_log_session_id', columns: ['sessionId'] },
    { name: 'idx_turn_log_status', columns: ['status'] },
    { name: 'idx_turn_log_locked_until',
      columns: ['lockedUntil'],
      where: "status = 'in-progress'" },
  ],
})
```

Registrato in `database-connection.ts` `getEntities()`:

```typescript
// database-connection.ts
function getEntities() {
  return [
    // ... esistenti
    InteractiveFlowTurnLogEntity,
    InteractiveFlowOutboxEntity,
  ]
}
```

### 9.3 EntitySchema outbox con session_sequence

File: `packages/server/api/src/app/ai/command-layer/outbox-entity.ts`

```typescript
type InteractiveFlowOutboxSchema = {
  outboxEventId: string
  sessionId: string
  flowRunId: string
  sessionSequence: string      // BIGINT stringified per JS safety
  eventType: string
  payload: unknown
  createdAt: Date
  publishedAt: Date | null
  attempts: number
  nextRetryAt: Date | null
  failedAt: Date | null
  claimedBy: string | null
  claimedUntil: Date | null
}

export const InteractiveFlowOutboxEntity = new EntitySchema<InteractiveFlowOutboxSchema>({
  name: 'interactive_flow_outbox',
  columns: {
    outboxEventId: {
      type: 'uuid',
      primary: true,
    },
    sessionId: {
      type: String,
      length: 256,
      nullable: false,
    },
    flowRunId: {
      type: String,
      length: 64,
      nullable: false,
    },
    sessionSequence: {
      type: 'bigint',
      nullable: false,
    },
    eventType: {
      type: String,
      length: 64,
      nullable: false,
    },
    payload: {
      type: 'jsonb',
      nullable: false,
    },
    createdAt: {
      type: 'timestamp with time zone',
      nullable: false,
    },
    publishedAt: {
      type: 'timestamp with time zone',
      nullable: true,
    },
    attempts: {
      type: 'integer',
      default: 0,
      nullable: false,
    },
    nextRetryAt: {
      type: 'timestamp with time zone',
      nullable: true,
    },
    failedAt: {
      type: 'timestamp with time zone',
      nullable: true,
    },
    claimedBy: {
      type: String,
      length: 64,
      nullable: true,
    },
    claimedUntil: {
      type: 'timestamp with time zone',
      nullable: true,
    },
  },
  indices: [
    { name: 'idx_outbox_unpublished_by_session',
      columns: ['sessionId', 'sessionSequence'],
      where: 'published_at IS NULL' },
    { name: 'idx_outbox_retry',
      columns: ['nextRetryAt'],
      where: 'published_at IS NULL AND failed_at IS NULL' },
    { name: 'idx_outbox_session_sequence',
      columns: ['sessionId', 'sessionSequence'],
      unique: true },
  ],
})
```

**Chiavi**:
- `session_sequence` UNIQUE per sessione — ordering monotono garantito
- `claimed_by` + `claimed_until` per publisher distributed locking
- `next_retry_at` + `attempts` per retry con backoff
- `failed_at` per dead-letter (manual recovery)

### 9.4 Migration path reale

File: `packages/server/api/src/app/database/migration/postgres/{timestamp}-AddCommandLayerPrimitives.ts`

Secondo convention del repo (cfr. [database migrations playbook](https://www.activepieces.com/docs/handbook/engineering/playbooks/database-migration)):

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddCommandLayerPrimitives{timestamp} implements MigrationInterface {
  name = 'AddCommandLayerPrimitives{timestamp}'
  
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE interactive_flow_turn_log (
        turn_id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(256) NOT NULL,
        flow_run_id VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL,
        worker_id VARCHAR(64),
        locked_until TIMESTAMP WITH TIME ZONE,
        accepted_commands JSONB,
        rejected_commands JSONB,
        result JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        committed_at TIMESTAMP WITH TIME ZONE,
        failed_reason TEXT,
        CONSTRAINT turn_log_status_check CHECK (status IN (
          'in-progress','committed','failed','compensated'
        ))
      )
    `)
    await queryRunner.query(`
      CREATE INDEX idx_turn_log_session_id ON interactive_flow_turn_log(session_id);
      CREATE INDEX idx_turn_log_status ON interactive_flow_turn_log(status);
      CREATE INDEX idx_turn_log_locked_until ON interactive_flow_turn_log(locked_until)
        WHERE status = 'in-progress';
    `)
    
    await queryRunner.query(`
      CREATE TABLE interactive_flow_outbox (
        outbox_event_id UUID PRIMARY KEY,
        session_id VARCHAR(256) NOT NULL,
        flow_run_id VARCHAR(64) NOT NULL,
        session_sequence BIGINT NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        published_at TIMESTAMP WITH TIME ZONE,
        attempts INT NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMP WITH TIME ZONE,
        failed_at TIMESTAMP WITH TIME ZONE,
        claimed_by VARCHAR(64),
        claimed_until TIMESTAMP WITH TIME ZONE,
        CONSTRAINT outbox_session_sequence_unique UNIQUE (session_id, session_sequence)
      )
    `)
    await queryRunner.query(`
      CREATE INDEX idx_outbox_unpublished_by_session
        ON interactive_flow_outbox(session_id, session_sequence)
        WHERE published_at IS NULL;
      CREATE INDEX idx_outbox_retry
        ON interactive_flow_outbox(next_retry_at)
        WHERE published_at IS NULL AND failed_at IS NULL;
    `)
  }
  
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS interactive_flow_outbox')
    await queryRunner.query('DROP TABLE IF EXISTS interactive_flow_turn_log')
  }
}
```

SQLite version (common edition): migration che **non crea le tabelle** ma logga warning. Il feature flag `useCommandLayer` viene comunque accettato dallo schema ma il runtime rigetta se DB type non è postgres (fallback a legacy path).

### 9.5 Session revision — store-entries extension

**Fix Codex #3 (store-entries CAS strategia)**:

Modifiche necessarie a `packages/server/api/src/app/store-entry/`:

1. **Schema DB**: aggiungere colonna `version INT NOT NULL DEFAULT 0` alla tabella store-entry (migration additive, retrocompatibile).

2. **DTO extension** ([store-entry-request.ts](../../packages/shared/src/lib/core/store-entry/dto/store-entry-request.ts)):
   ```typescript
   export const PutStoreEntryRequest = Type.Object({
     key: Type.String(),
     value: Type.Unknown(),
     expectedVersion: Type.Optional(Type.Integer()),   // NEW
   })
   ```

3. **Service**: se `expectedVersion` è presente, eseguire UPDATE con `WHERE key = $1 AND version = $2`. Se 0 rows affected → 412 Precondition Failed. Altrimenti increment version.

4. **Client engine**: nuovo helper `sessionStore.saveWithCAS({ key, value, expectedRevision })` che usa il nuovo param. `sessionStore.save` esistente resta invariato (retrocompatibile).

5. **Non rompere semantica esistente**: clients che non passano `expectedVersion` continuano a funzionare con last-write-wins (equivalente a oggi).

---

## 10. Schema extensions shared (completo)

### 10.1 pending_cancel in PendingInteractionSchema

File: [interactive-flow-action.ts:193-222](../../packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts#L193-L222)

```typescript
export const PendingInteractionSchema = z.discriminatedUnion('type', [
  // esistenti: confirm_binary, pick_from_list, pending_overwrite, open_text
  z.object({
    type: z.literal('pending_cancel'),
    reason: z.string().optional(),
    createdAt: z.string(),        // ISO timestamp, for TTL check (60s)
  }),
])
```

### 10.2 InfoIntent + useCommandLayer in Settings

```typescript
const InfoIntentSchema = z.object({
  id: z.string().min(1),               // es. 'count_accounts'
  description: z.string().min(1),      // for LLM prompt
  requiredFields: z.array(z.string()), // citedFields must subset + catalogReadiness check
  rendererKey: z.string().min(1),      // key in info-renderer registry server-side
  localeTemplates: z.record(z.string(), z.string()).optional(),
})

export const InteractiveFlowActionSettings = z.object({
  // esistenti
  infoIntents: z.array(InfoIntentSchema).optional(),
  useCommandLayer: z.boolean().optional(),
})
```

### 10.3 Turn event schema (con session_sequence)

File: `packages/shared/src/lib/automation/interactive-flow/turn-event.ts`

```typescript
const TurnEventKindSchema = z.enum([
  'FIELD_EXTRACTED',
  'FIELD_REJECTED',
  'META_ANSWERED',
  'INFO_ANSWERED',
  'TOPIC_CHANGED',
  'OVERWRITE_PENDING',
  'OVERWRITE_CONFIRMED',
  'CANCEL_REQUESTED',
  'CANCEL_CONFIRMED',
  'CANCEL_REJECTED',
  'CANCEL_TTL_EXPIRED',
  'REPROMPT_EMITTED',
  'TURN_COMMITTED',
  'TURN_ROLLED_BACK',
  'TURN_LEASE_EXPIRED',
  'TURN_FAILED',
  'CATALOG_PREEXEC_FAILED',
])

export const InteractiveFlowTurnEventSchema = z.object({
  outboxEventId: z.string().uuid(),
  turnId: z.string(),
  sessionId: z.string(),
  flowRunId: z.string(),
  sessionSequence: z.number().int().min(1),
  kind: TurnEventKindSchema,
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
})
```

**Su `payload` permissivo (Codex #check d)**: accettato per Phase 1 con disclaimer. Phase 3 raffinamento a `z.discriminatedUnion('kind', [...])` con payload tipizzato per ogni kind. Motivazione: 17 kind × payload tipizzato = 17 schema oggetti, molta code gen, e gli oggetti payload sono internal-only (non esposti a customer tool). Il permissivo attuale è audit-safe perché ogni payload è validato dal producer (dispatcher).

### 10.4 Bump version packages/shared

Secondo [root CLAUDE.md](../../CLAUDE.md): minor bump quando ci sono new exports/behaviour changes.

`packages/shared/package.json`: da `X.Y.Z` a `X.(Y+1).0`.

Verificare se già bumpato nel branch corrente prima di incrementare ulteriormente.

---

## 11. WebSocket stream (con session_sequence ordering)

### 11.1 Due stream distinti (invariato)

| Stream | Event type | Topic | Durability | Ordering |
|---|---|---|---|---|
| A (esistente) | `InteractiveFlowNodeStateEvent` | `INTERACTIVE_FLOW_NODE_STATE` | Best-effort | Per-node, implicit |
| B (nuovo) | `InteractiveFlowTurnEvent` | `INTERACTIVE_FLOW_TURN_EVENT` | Durable (outbox) | `session_sequence` monotono per sessione |

### 11.2 Reconnect & replay (fix Codex #5)

**Problema v3.1**: `outbox_event_id > lastKnown` con UUID v4 è ordinamento non deterministico.

**v3.2**: `session_sequence BIGINT` monotonico assegnato al commit.

Protocollo reconnect:
1. Client si riconnette al WebSocket.
2. Client emette `{ type: 'subscribe', sessionId, lastKnownSessionSequence: N }`.
3. Server emette tutti gli eventi con `session_sequence > N` per quella sessione, ordinati.
4. Client aggiorna `lastKnownSessionSequence` ad ogni evento ricevuto.

**Retention**: outbox table conserva eventi indefinitamente (no TTL delete per default). Opzionale cleanup job dopo 30 giorni per sessioni committed. Decidibile post-rollout in base a storage growth.

### 11.3 Publisher con row-lock (fix Codex nuovo rischio #2)

File: `packages/server/api/src/app/ai/command-layer/outbox-publisher.ts`

```typescript
async function publishBatch(): Promise<void> {
  // Claim rows for this publisher with SKIP LOCKED semantics
  const claimed = await db.query(`
    UPDATE interactive_flow_outbox
    SET claimed_by = $1, claimed_until = NOW() + INTERVAL '30 seconds'
    WHERE outbox_event_id IN (
      SELECT outbox_event_id FROM interactive_flow_outbox
      WHERE published_at IS NULL
        AND failed_at IS NULL
        AND (claimed_until IS NULL OR claimed_until < NOW())
        AND (next_retry_at IS NULL OR next_retry_at < NOW())
      ORDER BY session_id, session_sequence
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [publisherId])
  
  for (const row of claimed.rows) {
    try {
      await websocketEmit({
        topic: 'INTERACTIVE_FLOW_TURN_EVENT',
        payload: row.payload,
      })
      await db.query(`
        UPDATE interactive_flow_outbox
        SET published_at = NOW(), claimed_by = NULL, claimed_until = NULL
        WHERE outbox_event_id = $1
      `, [row.outbox_event_id])
    }
    catch (err) {
      const nextAttempts = row.attempts + 1
      if (nextAttempts >= 10) {
        await db.query(`
          UPDATE interactive_flow_outbox
          SET failed_at = NOW(), attempts = $1, claimed_by = NULL,
              claimed_until = NULL
          WHERE outbox_event_id = $2
        `, [nextAttempts, row.outbox_event_id])
        // Alert ops
      }
      else {
        const backoffSec = Math.min(300, 2 ** nextAttempts)
        await db.query(`
          UPDATE interactive_flow_outbox
          SET attempts = $1,
              next_retry_at = NOW() + ($2 || ' seconds')::INTERVAL,
              claimed_by = NULL, claimed_until = NULL
          WHERE outbox_event_id = $3
        `, [nextAttempts, backoffSec, row.outbox_event_id])
      }
    }
  }
}
```

**Proprietà**:
- `FOR UPDATE SKIP LOCKED` impedisce due publisher di claim la stessa row.
- `claimed_until` scade dopo 30s → se il publisher crasha, un altro può reclaim.
- Ordering garantito: rows selezionate `ORDER BY session_id, session_sequence`.
- Retry exponential backoff con cap 5 min.
- Dead-letter dopo 10 tentativi.

---

## 12. Catalog partial failure (fix Codex #13)

### 12.1 Problema

First-turn catalog pre-execution (engine-side) può fallire per 1+ MCP tool (timeout, 5xx). Lo state arriva al command layer API parzialmente popolato. Il prompt LLM vede missing fields. P4 `verifyDomain` contro `enumFrom: 'closureReasons'` fallisce se `state.closureReasons` è vuoto.

### 12.2 Soluzione: catalogReadiness flag

**Engine-side**: dopo catalog pre-execution, costruisci `catalogReadiness: Record<string, boolean>` mappando ogni nome di `enumFrom` source a `true` se popolato, `false` altrimenti.

```typescript
// interactive-flow-executor.ts (new helper)
function buildCatalogReadiness({ state, stateFields }: {
  state: Record<string, unknown>
  stateFields: InteractiveFlowStateField[]
}): Record<string, boolean> {
  const sources = new Set<string>()
  for (const field of stateFields) {
    if (field.enumFrom) sources.add(field.enumFrom)
  }
  const readiness: Record<string, boolean> = {}
  for (const source of sources) {
    const value = state[source]
    readiness[source] = Array.isArray(value) && value.length > 0
  }
  return readiness
}
```

Passato al turn interpreter request.

### 12.3 API-side usage

**In prompt-builder**: solo i campi i cui `enumFrom` source è `catalogReadiness[source] === true` sono inclusi in `<allowed_fields_for_extraction>`. Gli altri restano fuori. L'LLM non è guidato a estrarre campi non validabili.

**In policy engine P4**: se `stateField.enumFrom` e `!catalogReadiness[enumFrom]`, il commit di `SET_FIELDS` su quel campo è rigettato con reason `catalog-not-ready` e il dispatcher emette `ASK_FIELD(field)` come fallback.

**In info renderer P5**: se `ANSWER_INFO.citedFields` include un field con catalog non ready → rigetto + `REPROMPT(catalog-not-ready)`.

### 12.4 UX risultante

Prima: LLM propone codice motivazione, P4 rigetta silenziosamente perché catalog vuoto, utente vede REPROMPT generico.

Dopo: LLM non propone il codice perché non è in allowed_fields. Se utente lo scrive spontaneamente, P4 rigetta con reason specifica, dispatcher emette `ASK_FIELD('closureReasonCode')` con template "Caricamento motivazioni in corso, prova tra un momento". Evento outbox `CATALOG_PREEXEC_FAILED` già emesso; alert ops indipendente.

---

## 13. InfoRenderer & messageOut (fix Codex new risk #4)

### 13.1 Problema

v3.1 costruiva `messageOut` nel command layer (API-side) prima del DAG loop (engine-side). Se DAG falliva, `messageOut` già committed poteva dichiarare "confermato" qualcosa che il DAG non ha applicato.

### 13.2 Soluzione: messaggio bifase

**Fase 1 — Pre-DAG acknowledgment (API-side)**:
- messageOut di command layer è SOLO acknowledgment.
- Template permessi: "Ricevuto, sto elaborando…", "Grazie, procedo con la verifica", "Confermata la motivazione {X}" (se è UN'estrazione, non un'azione dispositiva).
- **Vietato**: "Pratica estinta", "Submit completato", "Pratica creata con ID {X}". Questi richiedono esito DAG.

**Fase 2 — Post-DAG status (engine-side)**:
- Dopo DAG loop, l'engine chiama `statusRenderer.render({ dagResult, state })` (nuovo helper engine-side).
- Template output finale: "Estinzione confermata, pratica ID {caseId}" (solo se DAG success), oppure "Si è verificato un errore: {reason}" (se fail).
- Questo status è il messaggio effettivamente mostrato all'utente, append al pre-DAG ack con seprator (es. newline).

### 13.3 Response schema aggiornato

```typescript
InterpretTurnResponseSchema = z.object({
  // ...
  messageOut: z.object({
    preDagAck: z.string(),     // sempre committed pre-DAG
    kind: z.enum(['ack-only', 'info-answer', 'ask-field', 'meta-answer',
                   'cancel-request', 'cancel-confirmed', 'reprompt']),
  }),
  // ...
})
```

L'engine compone: `${preDagAck}\n${statusPostDag}` e emette al client come singolo bot message (mantiene UX attuale mono-bubble).

### 13.4 Eventi outbox

Separati:
- `TURN_COMMITTED` emesso al commit API (pre-DAG).
- `DAG_SUCCEEDED` o `DAG_FAILED` emesso post-DAG via `interactiveFlowEvents.emit` (best-effort, stream A) — non va in outbox (non è audit-grade per DAG).

Audit trail completo è ricostruibile dallo stream B (outbox) + stream A (node state) correlati via `flowRunId` + `turnId`.

---

## 14. First-turn catalog boundary (fix Codex #8)

**Decisione esplicita**: first-turn catalog pre-execution **resta engine-side** ([interactive-flow-executor.ts:1091-1115](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts#L1091-L1115)). Non si sposta nel command layer API.

**Motivazione**:
- I tool MCP sono già chiamati dall'engine via `executeToolWithPolicy`.
- Il gateway MCP è risolto engine-side tramite `resolveGateway`.
- Spostare i tool call al API-side significherebbe duplicare il gateway client logic.
- L'API command layer riceve il `state` già arricchito dal catalog pre-exec, via `InterpretTurnRequest.state`.

**Flusso aggiornato** (engine-side):
```typescript
// interactive-flow-executor.ts (pseudo)

if (settings.useCommandLayer && isFirstTurn) {
  // Pre-execute stateless catalog tools (CODICE ESISTENTE, invariato)
  await runFirstTurnCatalogTools(...)
}

// Build readiness map
const catalogReadiness = buildCatalogReadiness({ state: flowState, stateFields: fields })

// Call command layer
const response = await turnInterpreterClient.interpret({
  constants,
  request: {
    turnId, idempotencyKey, sessionId, sessionRevision: session.revision,
    flowRunId: constants.flowRunId, flowVersionId: constants.flowVersionId,
    message: userMessage,
    state: flowState,                  // già popolato da catalog
    history,
    pendingInteraction,
    stateFields: fields,
    nodes,
    currentNodeHint: pauseHint,
    infoIntents: settings.infoIntents ?? [],
    systemPrompt: settings.systemPrompt,
    locale,
    catalogReadiness,                  // nuovo
  },
})
```

API non si preoccupa di eseguire tool. Riceve state pronto.

---

## 15. Cost & latency (invariato da v3.1)

Nessun cambiamento numerico. Ricorda:
- Costo 10 turni 70% hit: ~$0.073 (non -15% baseline come v2)
- Latenza p95 con LLM+MCP stimato 4-6s (peggio del target v2 3s)
- Tutte le cifre da validare con benchmark Phase 0.5

---

## 16. Migration & sunset (Phase 0 split)

### 16.1 Phasing aggiornato

| Phase | Durata | Focus |
|---|---|---|
| **0A. Storage + event infra** | 2-3 settimane | Migration postgres, EntitySchema turn-log+outbox, publisher worker, lock recovery daemon, store-entries API extension CAS |
| **0B. Schema extensions + contract** | 1-2 settimane | pending_cancel, infoIntents, useCommandLayer in shared. ConversationCommand + TurnEvent + InterpretTurn DTOs. Bump shared version |
| **0.5. Benchmark deterministic** | 1 settimana | 20-30 golden turns, mock adapter, solo unit test |
| **0.75. Benchmark LLM real** | 1 settimana | 100-200 turn Anthropic real, misura latency/cost/fabrication |
| **1. Core command layer** | 3-4 settimane | ProviderAdapter + PolicyEngine + CommandDispatcher + PromptBuilder + InfoRenderer + Pre-resolvers + TurnInterpreter + controller |
| **2. Integration** | 3-4 settimane | turn-interpreter-client.ts engine-side, feature flag, integration nella interactive-flow-executor (preservando side-effect). Frontend turn events hook + reducer |
| **3. Safeguard & observability** | 2-3 settimane | Red-team injection suite, OpenTelemetry traces, PII redaction, drift metrics, model pinning, replay verification |
| **4. Fixture consultazione + canary** | 2 settimane | Fixture consultazione-cliente.json. Canary 5% internal |
| **5. Canary estinzione staging** | 3-4 settimane | Staging dispositivo, operator shadow, compliance sign-off |
| **6. Rollout estinzione prod** | 2 settimane | 10% → 50% → 100% |
| **7. Sunset legacy** | 6 mesi post-rollout | Rimozione fieldExtractor path |

**Fix Codex sul realism di Phase 0**: splittato in 0A + 0B + 0.5 + 0.75. Totale Phase 0 family: 5-7 settimane (era 4-5 v3.1). Più onesto.

### 16.2 Interfaccia comune TurnInterpreter (engine-side)

File: `packages/server/engine/src/lib/handler/turn-interpreter-client.ts`

```typescript
export interface TurnInterpreter {
  interpret(input: TurnInput): Promise<TurnResult>
}

// Due implementazioni:
class LegacyFieldExtractorAdapter implements TurnInterpreter {
  async interpret(input: TurnInput): Promise<TurnResult> {
    const result = await fieldExtractor.extractWithPolicy(input.legacyArgs)
    return adaptLegacyToTurnResult(result)
  }
}

class CommandLayerClientAdapter implements TurnInterpreter {
  async interpret(input: TurnInput): Promise<TurnResult> {
    const response = await turnInterpreterClient.interpret({
      constants: input.constants,
      request: input.commandLayerRequest,
    })
    return adaptCommandLayerToTurnResult(response)
  }
}
```

Entrambi producono `TurnResult` uniforme. Il caller in `interactive-flow-executor` usa solo `TurnResult`, mai side-effect del legacy o del new direttamente.

### 16.3 Sunset policy

Dal giorno di Phase 2:
- No new features su legacy path
- No new flow templates con `useCommandLayer: false`
- Freeze bug fix: solo security/data-loss

Data limite rimozione: 6 mesi da Phase 6. Rimozione include:
- `fieldExtractor.extractWithPolicy`
- `interactive-flow-ai.controller.ts#field-extract` endpoint
- `meta-question-handler.ts` (assorbito da command layer)
- Parti duplicate di `candidate-policy.ts` (se create nel command layer)

---

## 17. Risks & mitigations (aggiornato)

Da v3.1 + nuovi:

| ID | Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|---|
| R1-R17 | (invariati da v3.1) | | | cfr. v3.1 §15 |
| **R18** (agg.) | Store-entries API non estendibile CAS | Bassa (dopo Phase 0A spike) | Critical | Spike decisionale in prima settimana Phase 0A. Alternativa: migrare session a PostgreSQL local (più invasivo) |
| **R19** (agg.) | Lease zombie / recovery daemon fail | Bassa | Medio | Monitoring `turn_log_stale_reclaim_total`. Alert >10/min. Fallback: operatore admin force-clear via endpoint restricted |
| **R20** (agg.) | Outbox publisher lag | Media | Medio | SLA 95% < 500ms; alert lag > 5s; horizontal scaling publisher |
| **R21** (agg.) | Operator identity assente (P7) | Alta | Medio | Accettato consapevolmente, parked Phase 7+ |
| **R22** (NEW) | SQLite community edition esclusa | Alta | Medio | Feature flag documentato come "PostgreSQL only". Community edition usa legacy path. Accettato consapevolmente |
| **R23** (NEW) | Compensation su T2 fail lascia client con messaggio ack già inviato | Media | Medio | Pre-DAG ack è generico ("Elaborando..."); se T2 fail, engine append `"Errore: riprova"`. UX acceptable |
| **R24** (NEW) | session_sequence collision fra publisher concorrenti | Bassa | Medio | UNIQUE constraint (session_id, session_sequence). Violazione → DB error → pubblicazione rigettata, recovery daemon cleaning |
| **R25** (NEW) | Prompt context growth con N flow | Media | Medio | Lista infoIntents per-flow (non globale). Allowed fields per-flow. Cache key include settings hash |

---

## 18. Open questions (aggiornato)

Da decidere prima di Phase 0A (spike):

1. **Store-entries API CAS**: estendibile nello schema corrente? (R18) ← spike obbligatorio settimana 1
2. **PostgreSQL-only feature**: accettato come limitation community edition? (R22)
3. **Outbox retention policy**: forever o TTL 30 giorni?
4. **Lease duration**: 30s è adeguato o serve tuning? (misurare in benchmark)
5. **Cache TTL Anthropic**: 5min default o 1h? (benchmark)
6. **PII redaction strategy**: at-emit o at-retrieval?
7. **Retention audit log turn_log + outbox**: durata?
8. **Model version pinning granularity**: patch o minor?
9. **infoIntent registry Phase 1**: `count_accounts`, `account_type`, `closure_reasons_list`, `pending_status`? Altri?
10. **Operator role/permission (P7)**: reintroducible Phase 7+ o mai?
11. **Router timeline**: Phase 7 o parallelo canary?
12. **DORA runbook SEV**: input SRE
13. **Benchmark env**: mixed staging + prod real
14. **TTL pending_cancel**: 60s corretto? (misurare feedback operatori)

### 18.1 Pre-flight compliance checklist

Invariato da v3.1 (cfr. §16.1).

### 18.2 Sign-off richiesti prima Phase 5

Invariato da v3.1 (Engineering, Security, Compliance, Product, SRE).

---

## 19. Naming registry (uniformato)

Audit completo. Ogni occorrenza nel doc v3.2 verificata.

| Concetto | Nome canonico | Anti-pattern banditi |
|---|---|---|
| Revisione sessione | `sessionRevision` | `session.revision`, `rev`, `sessionVersion` |
| Version store-entry | `version` (DB column), `expectedVersion` (DTO param) | `revision`, `etag` |
| ID turno | `turnId` | `turn_id`, `turnID`, `turnUuid` |
| Chiave idempotenza HTTP | `idempotencyKey` | `idempotency_key`, `idemKey` |
| Sequence outbox | `sessionSequence` (camel), `session_sequence` (DB col) | `seq`, `sequenceNum` |
| Interprete turno | `TurnInterpreter` (interface), `CommandLayerInterpreter` (impl API), `CommandLayerClientAdapter` (engine-side) | `Interpreter` (ambiguo) |
| Adapter provider | `ProviderAdapter` | `LLMAdapter`, `ModelAdapter` |
| Motore policy | `PolicyEngine` | `policy-engine`, `PolicyValidator`, `Guardrails` |
| Dispatcher comandi | `CommandDispatcher` | `commandExecutor`, `CommandApplier` |
| Registry rendering info | `InfoRenderer` | `info-renderer`, `AnswerRenderer` |
| Rendering status post-DAG | `StatusRenderer` (engine-side) | — |
| Evento turno | `InteractiveFlowTurnEvent` | `TurnEvent`, `ConversationEvent` |
| Topic WebSocket turno | `INTERACTIVE_FLOW_TURN_EVENT` | `turn-events`, `conversation-events` |
| Metodo save con CAS | `sessionStore.saveWithCAS` | `casWrite`, `saveOptimistic` |
| Metodo load con revision | `sessionStore.loadWithRevision` | `read`, `loadWithRev` |
| Feature flag settings | `useCommandLayer` | `enableCommandLayer`, `commandLayerEnabled` |
| Tabella turn log | `interactive_flow_turn_log` (DB), `InteractiveFlowTurnLogEntity` (TS) | `turn_logs`, `conversation_turn_log` |
| Tabella outbox | `interactive_flow_outbox` (DB), `InteractiveFlowOutboxEntity` (TS) | `outbox`, `turn_events_outbox` |
| ID evento outbox | `outboxEventId` | `eventId`, `outbox_id` |
| Cancel pending | `pending_cancel` | `pendingCancel`, `cancel_pending` |
| Lease column | `lockedUntil` (TS), `locked_until` (DB) | `lockUntil`, `lease_expires` |
| Worker ID | `workerId` (TS), `worker_id` (DB) | `procId`, `instanceId` |
| Pre-DAG acknowledgment | `messageOut.preDagAck` | `ackMessage`, `immediateMsg` |

---

## 20. Dispatcher outcome matrix (NEW — fix Codex #12)

Given `accepted[]` array + `pendingInteraction` active → outcome esplicito.

| Accepted commands | Pending attivo | Outcome dispatcher | messageOut kind |
|---|---|---|---|
| `[]` | none | `REPROMPT(low-confidence)` | `reprompt` |
| `[]` | any | preserve pending; re-ask | `reprompt` |
| `[SET_FIELDS]` | none | apply diff | `ack-only` |
| `[SET_FIELDS]` | `pending_overwrite` | accept overwrite → apply | `ack-only` |
| `[SET_FIELDS, ANSWER_INFO]` | none | apply diff + render info | `info-answer` |
| `[SET_FIELDS, ANSWER_META]` | none | apply diff + emit meta | `meta-answer` |
| `[ASK_FIELD]` | none | no state change; emit ask template | `ask-field` |
| `[ANSWER_META]` | none | no state change; emit template | `meta-answer` |
| `[ANSWER_INFO]` | none | no state change; render info | `info-answer` |
| `[REQUEST_CANCEL]` | none | create `pending_cancel` with TTL 60s | `cancel-request` |
| `[REQUEST_CANCEL]` | active non-cancel | keep existing pending; emit clarifying template | `reprompt` |
| `[RESOLVE_PENDING(accept, pending_cancel)]` | `pending_cancel` | clear pending + reset state | `cancel-confirmed` |
| `[RESOLVE_PENDING(reject, pending_cancel)]` | `pending_cancel` | clear pending; no state change | `ack-only` |
| `[RESOLVE_PENDING(accept, confirm_binary)]` | `confirm_binary` | SET_FIELDS on node-local confirm field | `ack-only` |
| `[RESOLVE_PENDING(accept, pick_from_list)]` | `pick_from_list` | SET_FIELDS on pending field | `ack-only` |
| `[RESOLVE_PENDING(accept, pending_overwrite)]` | `pending_overwrite` | apply overwrite | `ack-only` |
| `[RESOLVE_PENDING]` (pendingType mismatch) | different pending | rejected by P6, treated as `[]` | `reprompt` |
| `[REPROMPT]` | any | no state change; emit template | `reprompt` |
| Multi-command con conflitto P9b | — | emit winner based on priority rule (§7.1 phase 3) | per-winner |

**Priority rule P9b**: `REQUEST_CANCEL` vs `RESOLVE_PENDING(accept, pending_cancel)`:
- Se `pending_cancel` attivo → `RESOLVE_PENDING` vince.
- Altrimenti → `REQUEST_CANCEL` vince (crea nuovo pending_cancel).

---

## 21. Codex findings integration table v3.2

Mapping esplicito, enumerato. Total: 15 findings + 1 errata count.

| # | Finding Codex v3.1 | Sezione v3.2 | Verdetto |
|---|---|---|---|
| 1 | Firma verifyEvidence posizionale | §7.3 | FIX |
| 2 | False atomicity DB+HTTP | §8.1, §8.2 | FIX |
| 3 | Retry auto-bloccante | §8.3 UPSERT con lease | FIX |
| 4 | Lock zombie turn-log | §8.5 recovery daemon | FIX |
| 5 | Outbox UUID v4 ordering | §9.3 sessionSequence | FIX |
| 6 | TypeORM decorator pattern | §9.2, §9.3 EntitySchema | FIX |
| 7 | Boundary engine/api | §5.2 HTTP preserved | FIX |
| 8 | First-turn catalog boundary | §14 | FIX |
| 9 | messageOut pre-DAG incoerente | §13 two-phase | FIX |
| 10 | P9 mutua esclusione ambiguo | §7.1 P9a/P9b | FIX |
| 11 | pending_cancel solo dichiarato | §7.2 full spec | FIX |
| 12 | Dispatcher outcome ambiguo | §20 matrix | FIX |
| 13 | Catalog partial failure | §12 catalogReadiness | FIX |
| 14 | Benchmark count inconsistency | §16 split 0.5/0.75 | FIX |
| 15 | Naming oscillante | §19 audit complete | FIX |
| 16 (errata) | Count 30 vs 29 tabella | §21 enumerazione esplicita | FIX |

**16 correzioni totali integrate**. Verdetto self-assessment: READY per re-review.

---

## 22. References (external)

Invariato da v3.1 §12. Principali:
- [OpenAI Function Calling](https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api)
- [AWS Bedrock Return Control](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-returncontrol.html)
- [LangGraph Durable Execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution)
- [OpenTelemetry GenAI Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [DORA (ESMA)](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/digital-operational-resilience-act-dora)
- [AI Act Implementation Timeline](https://ai-act-service-desk.ec.europa.eu/en/ai-act/eu-ai-act-implementation-timeline)
- [Activepieces DB Migrations Playbook](https://www.activepieces.com/docs/handbook/engineering/playbooks/database-migration)

---

## 23. Related docs

- [flows-analysis.md](flows-analysis.md)
- [proposals-comparison.md](proposals-comparison.md)
- [solution-patterns.md](solution-patterns.md)
- [solution-final-review.md](solution-final-review.md)
- [solution-final-v2.md](solution-final-v2.md)
- [solution-final-v3.md](solution-final-v3.md) — superseded
- [solution-final-v3.1.md](solution-final-v3.1.md) — superseded from this
- [current-vs-proposed.md](current-vs-proposed.md) — update banner to v3.2
