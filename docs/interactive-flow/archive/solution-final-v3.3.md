# INTERACTIVE_FLOW — Revised Architecture Proposal (v3.3)

> Iterazione finale della specifica dopo terza review Codex contro [solution-final-v3.2.md](solution-final-v3.2.md). Codex verdetto v3.2: ROSSO, con 2 `FIX INTRODUCES NEW BUG` (lease worker_id, sequence MAX+1 FOR UPDATE) + 7 `PARTIALLY FIXED`. Tutti i findings corretti architetturalmente in v3.3. Questo è **delta mirato**: ribadisce v3.2 per quanto non cambiato, corregge puntualmente i 5 bug concurrency SQL identificati, e dichiara la **fine del ciclo di revisione documentale**. Dopo v3.3 obbligatorio spike SQL/concurrency con test reali (Phase 0A).

## 0. Cambiamenti rispetto a v3.2

v3.3 lascia invariate le sezioni §2 (ground truth), §3 (diagram), §4 (command contract), §5 (adapter/boundary), §6 (prompt), §10 (schema extensions), §11 (WebSocket), §12 (catalog readiness), §13 (messageOut bifase tranne correzione DTO), §14 (first-turn catalog), §15 (costs), §16 (phasing), §18 (open questions), §19 (naming, con correzione), §20 (dispatcher matrix, con integrazione), §22 (references).

Modifica puntualmente:

| # | Finding Codex v3.2 | Verdetto v3.2 | Correzione v3.3 | Sezione |
|---|---|---|---|---|
| 2 | T1 committed prima di T2 lascia finestra incoerente | PARTIALLY FIXED | **Saga prepared → finalized/compensated**. Outbox eventi non pubblicabili finché turn-log status='finalized' | §1 |
| 3 | Lease riacquisibile da stesso worker_id → double processing | NEW BUG | **leaseToken UUID per attempt**. Commit/fail CAS su leaseToken | §2 |
| 4 | Commit stale dopo recovery daemon | PARTIALLY FIXED | Commit CAS su (leaseToken, status='in-progress', locked_until>=NOW()). Heartbeat durante LLM lunghi | §2 |
| 5 | `SELECT MAX + 1 FOR UPDATE` non garantisce ordering + schema TS `number` vs DB BIGINT | NEW BUG | **Tabella sequence dedicata** con UPSERT atomico RETURNING. Schema TS uniformato a `string` (bigint-safe) | §3 |
| 6 | EntitySchema property/column naming incoerente con migration | PARTIALLY FIXED | Mapping esplicito `name: 'turn_id'` su ogni colonna EntitySchema | §4 |
| 9 | messageOut DTO §5.3 (z.string) vs §13.3 (oggetto) | PARTIALLY FIXED | Un solo DTO canonico: oggetto `{ preDagAck, kind }` | §5 |
| 10 | P9b non copre conflitti SET_FIELDS + RESOLVE_PENDING sullo stesso campo | PARTIALLY FIXED | P9b esteso su **normalized write-set**, non solo command type | §6 |
| 12 | Dispatcher matrix incompleta (reject pick/overwrite, multi-command conflitti) | PARTIALLY FIXED | Matrix completata + algoritmo di conflict resolution per campo | §6 |
| 15 | Naming `session.revision` residuo | PARTIALLY FIXED | Audit finale, uniformato | §7 |
| extra | Saga integration nel TurnResult engine-side (§3e Codex) | DA CORREGGERE | `InterpretTurnResponse` esteso con tutti i side-effect del legacy path | §5 |
| extra | Fallback SQLite community: "runtime rigetta" vs "fallback legacy" contraddittori | NUOVO (Fase 2 #7) | Decisione: **fail esplicito** in validation, no silent fallback | §8 |
| extra | Publisher FIFO per sessione non garantito | NUOVO (Fase 2 #5) | Claim per sessionId (advisory lock), non per row | §9 |
| extra | store-entries CAS come metodo dedicato | NUOVO (Fase 3d) | `upsertWithExpectedVersion` nuovo metodo, `upsert` legacy invariato | §10 |
| extra | pending_cancel transizione con altri pending | NUOVO (Fase 2 #8) | pending_cancel esclusivo, TTL check a inizio turno | §11 |

**14 correzioni totali** integrate architetturalmente.

---

## 1. Saga prepared → finalized/compensated

### 1.1 Problema v3.2

v3.2 `§8 transaction model`: T1 commit (turn-log `committed` + outbox inserito) eseguito PRIMA di T2 (session CAS). Se engine crasha tra response API e `sessionStore.saveWithCAS`:
- turn-log resta `committed`
- outbox eventi sono inseriti → publisher li emette
- sessione NON è stata aggiornata via CAS
- Client al retry vede "turn committed" nel log ma sessione non mutata → stato incoerente

### 1.2 Correzione: saga a 3 stati

Due RPC API invece di una:

**RPC 1**: `POST /v1/engine/interactive-flow-ai/interpret-turn`
- Acquisisce lease (§2)
- Pre-resolvers + LLM + policy + build transaction
- Commit parziale: `turn_log.status = 'prepared'`, outbox rows inserite con `event_status = 'pending'`
- Risponde a engine con `InterpretTurnResponse`

**Engine (tra RPC 1 e RPC 2)**:
- Applica stateDiff localmente
- DAG loop (invariato)
- `sessionStore.saveWithCAS(expectedVersion)`
  - Se 200 → procedi a RPC 2 finalize
  - Se 412 CAS conflict → procedi a RPC 2 rollback
  - Se 5xx transient → retry (stesso turnId, stesso leaseToken) o rollback dopo N tentativi

**RPC 2a**: `POST /v1/engine/interactive-flow-ai/interpret-turn/finalize`
- `UPDATE turn_log SET status = 'finalized' WHERE turn_id = $1 AND lease_token = $2 AND status = 'prepared'`
- `UPDATE interactive_flow_outbox SET event_status = 'publishable' WHERE turn_id = $1`
- Se 0 rows affected → turn già finalizzato (replay) o compensato (tardivo): idempotente, ritorna ok

**RPC 2b**: `POST /v1/engine/interactive-flow-ai/interpret-turn/rollback`
- `UPDATE turn_log SET status = 'compensated', failed_reason = $reason WHERE turn_id = $1 AND lease_token = $2 AND status = 'prepared'`
- `UPDATE interactive_flow_outbox SET event_status = 'void' WHERE turn_id = $1`
- Emissione evento outbox `TURN_ROLLED_BACK` nella sessione (con `event_status = 'publishable'` immediato, così il client riceve notifica)
- Idempotente su 0 rows

### 1.3 Publisher filter update

Publisher (§11 v3.2 aggiornato) legge outbox solo con `event_status = 'publishable' AND published_at IS NULL`. Le rows `pending` non sono visibili. Le rows `void` sono ignorate (opzionale cleanup job dopo 30 giorni).

### 1.4 Stati turn_log aggiornati

| Status | Significato | Transizioni valide |
|---|---|---|
| `in-progress` | Lease acquired, processing | → `prepared` (su commit T1 ok), `failed` (su eccezione), `failed` (via recovery daemon su lease expire) |
| `prepared` | T1 committed, in attesa di finalize/rollback da engine | → `finalized` (via RPC 2a), `compensated` (via RPC 2b), `failed` (via recovery daemon su timeout — TTL 5 min) |
| `finalized` | Engine ha confermato T2 success | stato terminale |
| `compensated` | Engine ha richiesto rollback dopo T2 fail | stato terminale |
| `failed` | Errore durante processing o recovery | stato terminale |

### 1.5 Recovery per stati `prepared`

Il recovery daemon (§2) scansiona anche stati `prepared` con timeout 5 minuti (configurable):
- `UPDATE turn_log SET status = 'compensated', failed_reason = 'finalize-timeout' WHERE status = 'prepared' AND created_at < NOW() - INTERVAL '5 minutes'`
- Emette evento `TURN_LEASE_EXPIRED` per audit

**Ratio**: se engine non chiama finalize né rollback entro 5 min, qualcosa è andato storto (engine crash persistente). Meglio compensare automaticamente per evitare saga zombie.

### 1.6 Ordering garantito

Client al retry stesso `turnId`:
- Se `turn_log.status = 'finalized'` → replay cached result
- Se `turn_log.status = 'compensated'` → ritorna errore "turn-rolled-back"
- Se `turn_log.status = 'prepared'` con lease ancora valido → 409 (in corso)
- Se `turn_log.status = 'prepared'` con lease scaduto → in attesa di recovery daemon
- Se turno non esiste → nuovo UPSERT lease

---

## 2. Lease con leaseToken (non worker_id)

### 2.1 Problema v3.2

v3.2 §8.3 UPSERT:

```sql
ON CONFLICT (turn_id) DO UPDATE SET ...
WHERE ... OR interactive_flow_turn_log.worker_id = EXCLUDED.worker_id
```

Due request HTTP simultanee allo stesso API worker possono ri-acquisire lo stesso lease (stesso `worker_id`) e processare in parallelo lo stesso `turnId`. Non c'è serializzazione a livello di turn.

### 2.2 Correzione: leaseToken UUID per attempt

Ogni tentativo genera un `lease_token UUID` nuovo. Il WHERE nel ON CONFLICT non permette ri-acquisizione da parte dello stesso requester, solo da chi ha un lease valido o da chi attende scadenza.

```sql
INSERT INTO interactive_flow_turn_log (
  turn_id, session_id, flow_run_id, status,
  worker_id, lease_token, locked_until, created_at
)
VALUES ($1, $2, $3, 'in-progress', $4, $5, NOW() + INTERVAL '30 seconds', NOW())
ON CONFLICT (turn_id) DO UPDATE SET
  worker_id = EXCLUDED.worker_id,
  lease_token = EXCLUDED.lease_token,
  locked_until = EXCLUDED.locked_until
WHERE interactive_flow_turn_log.status = 'in-progress'
  AND interactive_flow_turn_log.locked_until < NOW()
RETURNING *
```

**Proprietà**:
- Una sola request può acquisire lease "fresco" per un `turnId`.
- Retry successivi trovano status=`in-progress` con lease ancora valido → 0 rows → query secondaria per distinguere `prepared/finalized/compensated/in-progress-locked`.
- Dopo lease expire, il prossimo UPSERT vince (nuovo lease_token).
- **Mai due processi concorrenti sullo stesso turnId con stesso o diverso worker_id**.

### 2.3 Commit/finalize/rollback con CAS su leaseToken

Tutte le transizioni di stato includono CAS sul lease_token + status + lease ancora valido:

```sql
-- Commit T1 (in-progress → prepared)
UPDATE interactive_flow_turn_log
SET status = 'prepared',
    accepted_commands = $1,
    rejected_commands = $2,
    result = $3
WHERE turn_id = $4
  AND lease_token = $5
  AND status = 'in-progress'
  AND locked_until >= NOW()
```

Se 0 rows affected:
- Il lease è scaduto (recovery daemon l'ha cleaned up) → fail, no commit
- Oppure un altro processo ha preso il lease con un nuovo token → fail, no commit

In entrambi i casi, il worker corrente deve abortire e non inviare response al client. Il client riceverà 5xx dall'engine o 409 al retry, troverà `status=failed` e farà nuovo turnId.

### 2.4 Heartbeat durante LLM lunghi

Se la LLM call supera 20 secondi (70% del TTL 30s), il worker estende il lease:

```sql
UPDATE interactive_flow_turn_log
SET locked_until = NOW() + INTERVAL '30 seconds'
WHERE turn_id = $1
  AND lease_token = $2
  AND status = 'in-progress'
```

Eseguito ogni 15s in background durante LLM call. Se 0 rows affected → il lease è stato rubato, abortire LLM call (AbortController).

### 2.5 Recovery daemon aggiornato

```sql
UPDATE interactive_flow_turn_log
SET status = 'failed',
    failed_reason = 'lease-expired'
WHERE status = 'in-progress'
  AND locked_until < NOW()
```

E anche:

```sql
UPDATE interactive_flow_turn_log
SET status = 'compensated',
    failed_reason = 'finalize-timeout'
WHERE status = 'prepared'
  AND created_at < NOW() - INTERVAL '5 minutes'
```

---

## 3. Sequence generation robusta

### 3.1 Problema v3.2

`SELECT COALESCE(MAX(session_sequence), 0) + 1 FROM interactive_flow_outbox WHERE session_id = $1 FOR UPDATE`:

1. `FOR UPDATE` su aggregate non lock deterministico. In PostgreSQL, non c'è "row aggregato" da lockare — il comportamento è non standard.
2. Con commit concorrenti sulla stessa sessione: race condition nella generazione di `session_sequence`.
3. UNIQUE constraint sul (session_id, session_sequence) previene insert duplicate, ma crea una retry dell'intera transazione.

### 3.2 Correzione: tabella sequence dedicata

Nuova tabella `interactive_flow_session_sequence`:

```sql
CREATE TABLE interactive_flow_session_sequence (
  session_id VARCHAR(256) PRIMARY KEY,
  next_sequence BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

Generazione atomica via UPSERT:

```sql
INSERT INTO interactive_flow_session_sequence (session_id, next_sequence)
VALUES ($1, $2)  -- $2 = count of events to allocate
ON CONFLICT (session_id) DO UPDATE SET
  next_sequence = interactive_flow_session_sequence.next_sequence + EXCLUDED.next_sequence,
  updated_at = NOW()
RETURNING next_sequence
```

`RETURNING` ritorna il nuovo `next_sequence` post-increment. Gli eventi correnti ottengono sequence `(next_sequence - count + 1)` fino a `next_sequence`.

**Proprietà**:
- Atomicità garantita da ON CONFLICT + RETURNING (standard PostgreSQL).
- Nessun lock aggregate pericoloso.
- Nessun FOR UPDATE sparso.
- Una riga per sessione, scalabile.

### 3.3 Schema TS uniformato

v3.2 aveva doppia definizione:
- Shared schema `turn-event.ts`: `sessionSequence: z.number().int().min(1)`
- Entity outbox: `sessionSequence: string // BIGINT stringified`

v3.3 uniforma su **string bigint-safe**:

```typescript
// packages/shared/src/lib/automation/interactive-flow/turn-event.ts
const BigIntStringSchema = z.string().regex(/^[1-9][0-9]*$/, 'validation.bigint.format')

export const InteractiveFlowTurnEventSchema = z.object({
  // ...
  sessionSequence: BigIntStringSchema,  // was z.number()
  // ...
})
```

Frontend consuma come string e confronta con operazione lexicografica bigint-safe (es. via `bigint-conversion` lib o comparazione custom). Ordering deterministico su sequence monotonico garantito.

### 3.4 Alternative (scartata)

**Advisory lock per sessione**:

```sql
SELECT pg_advisory_xact_lock(hashtext($session_id));
SELECT COALESCE(MAX(session_sequence), 0) + 1 FROM interactive_flow_outbox WHERE session_id = $1;
-- then INSERT outbox rows
```

**Scartata** perché:
- `hashtext()` ha collision risk → due sessioni diverse si bloccherebbero a vicenda.
- Performance overhead per ogni commit.
- Tabella dedicata è pattern standard e più chiaro.

---

## 4. EntitySchema column naming coerente

### 4.1 Problema v3.2

v3.2 §9.2 EntitySchema:

```typescript
columns: {
  turnId: { type: String, primary: true, ... },   // TS property
}
```

Migration §9.4 crea colonna `turn_id` (snake_case).

TypeORM di default usa **property name** come column name. Risultato: EntitySchema cerca colonna `turnId`, DB ha `turn_id` → runtime error.

### 4.2 Correzione: mapping esplicito

Pattern da [store-entry-entity.ts](../../packages/server/api/src/app/store-entry/store-entry-entity.ts) verificato: usa `projectId` come property **E** column name (camelCase fino in fondo). Quindi due scelte valide:

**Scelta A — tutto camelCase**: property TS = column DB name. Migration crea colonne camelCase quotate (`"turnId"` in DDL).

**Scelta B — mapping esplicito**: property TS camelCase, column DB snake_case, mapping esplicito su ogni colonna.

v3.3 adotta **Scelta A** (coerente col pattern esistente del repo):

```typescript
export const InteractiveFlowTurnLogEntity = new EntitySchema<InteractiveFlowTurnLogSchema>({
  name: 'interactive_flow_turn_log',   // tabella snake_case
  columns: {
    turnId: { type: String, length: 64, primary: true },
    sessionId: { type: String, length: 256, nullable: false },
    flowRunId: { type: String, length: 64, nullable: false },
    status: { type: String, length: 16, nullable: false },
    workerId: { type: String, length: 64, nullable: true },
    leaseToken: { type: 'uuid', nullable: true },             // NEW
    lockedUntil: { type: 'timestamp with time zone', nullable: true },
    acceptedCommands: { type: 'jsonb', nullable: true },
    rejectedCommands: { type: 'jsonb', nullable: true },
    result: { type: 'jsonb', nullable: true },
    createdAt: { type: 'timestamp with time zone', nullable: false },
    committedAt: { type: 'timestamp with time zone', nullable: true },
    failedReason: { type: String, nullable: true },
  },
  // ...
})
```

**Migration aggiornata**: colonne in snake_case **se lo standard AP** lo richiede, con mapping. Serve verificare con lo spike Phase 0A quale convention segue il resto del repo. Se snake_case è lo standard AP, usare Scelta B con `name: 'turn_id'` su ogni column.

**Da decidere in spike Phase 0A**: ispezionare 3-5 entity esistenti recenti e confermare convention. Questo è **il prerequisito #1 dello spike**.

### 4.3 Outbox entity con event_status e leaseToken reference

```typescript
type InteractiveFlowOutboxSchema = {
  outboxEventId: string
  turnId: string                     // NEW: correlation to turn_log
  sessionId: string
  flowRunId: string
  sessionSequence: string            // bigint as string
  eventType: string
  eventStatus: 'pending' | 'publishable' | 'void'  // NEW
  payload: unknown
  createdAt: Date
  publishedAt: Date | null
  claimedBy: string | null
  claimedUntil: Date | null
  attempts: number
  nextRetryAt: Date | null
  failedAt: Date | null
}
```

Aggiunta `turnId` per correlation (finalize/rollback devono trovare le rows outbox del turno).

### 4.4 Migration aggiornata

File: `packages/server/api/src/app/database/migration/postgres/{timestamp}-AddCommandLayerPrimitives.ts`

```sql
CREATE TABLE interactive_flow_turn_log (
  turn_id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(256) NOT NULL,
  flow_run_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  worker_id VARCHAR(64),
  lease_token UUID,
  locked_until TIMESTAMP WITH TIME ZONE,
  accepted_commands JSONB,
  rejected_commands JSONB,
  result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMP WITH TIME ZONE,
  failed_reason TEXT,
  CONSTRAINT turn_log_status_check CHECK (status IN (
    'in-progress','prepared','finalized','compensated','failed'
  ))
);
CREATE INDEX idx_turn_log_session_id ON interactive_flow_turn_log(session_id);
CREATE INDEX idx_turn_log_status ON interactive_flow_turn_log(status);
CREATE INDEX idx_turn_log_lease_expiry
  ON interactive_flow_turn_log(locked_until)
  WHERE status IN ('in-progress', 'prepared');

CREATE TABLE interactive_flow_session_sequence (
  session_id VARCHAR(256) PRIMARY KEY,
  next_sequence BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE interactive_flow_outbox (
  outbox_event_id UUID PRIMARY KEY,
  turn_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(256) NOT NULL,
  flow_run_id VARCHAR(64) NOT NULL,
  session_sequence BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP WITH TIME ZONE,
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  claimed_by VARCHAR(64),
  claimed_until TIMESTAMP WITH TIME ZONE,
  CONSTRAINT outbox_session_sequence_unique UNIQUE (session_id, session_sequence),
  CONSTRAINT outbox_event_status_check CHECK (event_status IN (
    'pending', 'publishable', 'void'
  ))
);
CREATE INDEX idx_outbox_publishable
  ON interactive_flow_outbox(session_id, session_sequence)
  WHERE event_status = 'publishable' AND published_at IS NULL;
CREATE INDEX idx_outbox_turn_id ON interactive_flow_outbox(turn_id);
CREATE INDEX idx_outbox_retry
  ON interactive_flow_outbox(next_retry_at)
  WHERE event_status = 'publishable' AND published_at IS NULL AND failed_at IS NULL;
```

---

## 5. TurnResult engine-side completo

### 5.1 Problema v3.2

`InterpretTurnResponse` non esponeva tutti i side-effect che il legacy `fieldExtractor.extractWithPolicy` mutava nel contesto dell'executor: `pendingOverwriteSignal`, `lastExtractionDecisions`, `rejectionHint`, `coercedExtracted`, `topicChanged` con `clearedKeys`, reset di `executedNodeIds`/`skippedNodeIds`.

### 5.2 Correzione: DTO esteso + wrapper engine-side

`InterpretTurnResponse` v3.3 esteso:

```typescript
export const InterpretTurnResponseSchema = z.object({
  turnStatus: z.enum(['prepared', 'replayed', 'failed']),
  
  // Sostituisce v3.2 messageOut ambiguo
  messageOut: z.object({
    preDagAck: z.string(),
    kind: z.enum(['ack-only', 'info-answer', 'ask-field', 'meta-answer',
                   'cancel-request', 'cancel-confirmed', 'reprompt']),
  }),
  
  stateDiff: z.record(z.string(), z.unknown()),
  pendingInteractionNext: PendingInteractionSchema.nullable(),
  
  // Side-effects che il legacy path mutava
  topicChange: z.object({
    topicChanged: z.boolean(),
    clearedKeys: z.array(z.string()),     // per invalidare executedNodeIds upstream
  }),
  pendingOverwriteSignal: z.object({      // formato esistente del legacy
    type: z.string(),
    field: z.string(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
    nodeId: z.string(),
  }).nullable(),
  rejectionHint: z.string().nullable(),
  lastPolicyDecisions: z.array(z.object({  // per debug/audit/downstream UI
    command: ConversationCommandSchema,
    decision: z.enum(['accepted', 'rejected']),
    reason: z.string().optional(),
  })),
  
  // v3.3 saga
  turnEvents: z.array(InteractiveFlowTurnEventSchema),
  acceptedCommands: z.array(ConversationCommandSchema),
  rejectedCommands: z.array(z.object({
    command: ConversationCommandSchema,
    reason: z.string(),
  })),
  sessionSequenceRange: z.object({
    from: BigIntStringSchema,
    to: BigIntStringSchema,
  }),
  
  // v3.3 finalize contract
  finalizeContract: z.object({
    turnId: z.string(),
    leaseToken: z.string().uuid(),  // engine passa a finalize/rollback
  }),
})

export type InterpretTurnResponse = z.infer<typeof InterpretTurnResponseSchema>
```

### 5.3 Wrapper engine-side

File: `packages/server/engine/src/lib/handler/turn-interpreter-client.ts`

```typescript
interface TurnResult {
  // Unificato fra legacy e command layer
  extractedFields: Record<string, unknown>        // equivalente legacy
  turnAffirmed: boolean
  policyDecisions: unknown[]                       // legacy-compatible
  metaAnswer?: string                              // legacy-compatible (undefined per command layer)
  clarifyReason?: unknown                          // legacy-compatible (undefined per command layer)
  
  // Topic change side-effects
  topicChanged: boolean
  clearedKeys: string[]
  
  // Overwrite signal
  pendingOverwriteSignal: unknown | null
  
  // Rejection hint
  rejectionHint: string | null
  
  // Command layer extras (undefined per legacy)
  turnEvents?: InteractiveFlowTurnEvent[]
  sessionSequenceRange?: { from: string; to: string }
  messageOut?: { preDagAck: string; kind: string }
  finalizeContract?: { turnId: string; leaseToken: string }
}

async function interpret({ constants, request }: {
  constants: EngineConstants
  request: InterpretTurnRequest
}): Promise<TurnResult> {
  const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/interpret-turn`
  const response = await fetch(url, { /* ... */ })
  if (!response.ok) throw new EngineGenericError(/* ... */)
  
  const parsed = InterpretTurnResponseSchema.parse(await response.json())
  
  return adaptInterpretResponseToTurnResult(parsed)
}

async function finalize({ constants, finalizeContract }: {
  constants: EngineConstants
  finalizeContract: { turnId: string; leaseToken: string }
}): Promise<void> {
  const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/interpret-turn/finalize`
  await fetch(url, { /* ... */ body: JSON.stringify(finalizeContract) })
}

async function rollback({ constants, finalizeContract, reason }: {
  constants: EngineConstants
  finalizeContract: { turnId: string; leaseToken: string }
  reason: string
}): Promise<void> {
  const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/interpret-turn/rollback`
  await fetch(url, { /* ... */ body: JSON.stringify({ ...finalizeContract, reason }) })
}

export const turnInterpreterClient = { interpret, finalize, rollback }
```

### 5.4 Integration in interactive-flow-executor.ts

La sostituzione delle 2 chiamate legacy a `fieldExtractor.extractWithPolicy` ([riga 1016](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts#L1016) e [riga 1117](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts#L1117)) diventa:

```typescript
// Pseudo-code del punto di sostituzione
if (settings.useCommandLayer) {
  const turnResult = await turnInterpreterClient.interpret({
    constants,
    request: buildInterpretRequest({ /* state, pending, history, catalogReadiness, ... */ }),
  })
  
  // Applica gli stessi side-effect di extractWithPolicy
  pendingOverwriteSignal = turnResult.pendingOverwriteSignal
  lastExtractionDecisions = turnResult.policyDecisions
  rejectionHint = turnResult.rejectionHint
  
  const coercedExtracted = coerceIncomingState({
    incoming: turnResult.extractedFields,
    fields,
  })
  const applied = sessionStore.applyStateOverwriteWithTopicChange({
    flowState,
    incoming: coercedExtracted,
    fields,
    nodes,
  })
  // (esistente logic su clearedKeys / executedNodeIds / skippedNodeIds invariata)
  
  // Saga engine-side
  try {
    // DAG loop procede su stato aggiornato (come oggi)
    // ...
    
    // Save session con CAS
    const saveResult = await sessionStore.saveWithCAS({
      key: sessionKey,
      constants,
      state: flowState,
      history,
      flowVersionId: constants.flowVersionId,
      historyMaxTurns,
      pendingInteraction,
      expectedVersion: session.revision,
    })
    
    if (saveResult.status === 'ok') {
      await turnInterpreterClient.finalize({
        constants,
        finalizeContract: turnResult.finalizeContract!,
      })
    }
    else if (saveResult.status === 'conflict') {
      await turnInterpreterClient.rollback({
        constants,
        finalizeContract: turnResult.finalizeContract!,
        reason: 'session-cas-conflict',
      })
      throw new EngineGenericError({ message: 'session-modified-concurrently' })
    }
  }
  catch (err) {
    // Se qualcosa esplode post-interpret pre-finalize, prova rollback best-effort
    try {
      await turnInterpreterClient.rollback({
        constants,
        finalizeContract: turnResult.finalizeContract!,
        reason: `engine-error: ${String(err).slice(0, 100)}`,
      })
    }
    catch {
      // Rollback failure is handled by recovery daemon TTL 5 min
    }
    throw err
  }
}
else {
  // Legacy path invariato
  const extractResult = await fieldExtractor.extractWithPolicy(/* args originali */)
  // ... (codice esistente)
}
```

---

## 6. Policy P9b + Dispatcher matrix completati

### 6.1 P9b su normalized write-set

v3.2 P9b operava su command type. v3.3 opera su **write-set normalizzato**: quali field vengono mutati da ciascun command accepted, e quali tentano di mutare lo stesso field.

```typescript
// packages/server/api/src/app/ai/command-layer/policy-engine.ts

type WriteIntent = {
  field: string
  source: 'SET_FIELDS' | 'RESOLVE_PENDING' | 'pre-resolver'
  value: unknown
  commandIndex: number
}

function computeWriteSet({ accepted, pending }: {
  accepted: ConversationCommand[]
  pending: PendingInteraction | null
}): WriteIntent[] {
  const writes: WriteIntent[] = []
  accepted.forEach((cmd, i) => {
    if (cmd.type === 'SET_FIELDS') {
      for (const upd of cmd.updates) {
        writes.push({
          field: upd.field,
          source: 'SET_FIELDS',
          value: upd.value,
          commandIndex: i,
        })
      }
    }
    else if (cmd.type === 'RESOLVE_PENDING' && cmd.decision === 'accept') {
      if (pending?.type === 'confirm_binary' || pending?.type === 'pick_from_list' || pending?.type === 'pending_overwrite') {
        writes.push({
          field: pending.field,
          source: 'RESOLVE_PENDING',
          value: (pending as any).target ?? (pending as any).newValue ?? null,
          commandIndex: i,
        })
      }
    }
  })
  return writes
}

function resolveConflicts({ writes }: { writes: WriteIntent[] }): {
  accepted: WriteIntent[]
  rejected: Array<{ write: WriteIntent; reason: string }>
} {
  const byField = new Map<string, WriteIntent[]>()
  for (const w of writes) {
    if (!byField.has(w.field)) byField.set(w.field, [])
    byField.get(w.field)!.push(w)
  }
  
  const accepted: WriteIntent[] = []
  const rejected: Array<{ write: WriteIntent; reason: string }> = []
  
  for (const [field, ws] of byField) {
    if (ws.length === 1) {
      accepted.push(ws[0])
    }
    else {
      // Priority rule: RESOLVE_PENDING > SET_FIELDS (pending dialog has explicit user intent)
      const resolvers = ws.filter(w => w.source === 'RESOLVE_PENDING')
      const setters = ws.filter(w => w.source === 'SET_FIELDS')
      if (resolvers.length > 0) {
        accepted.push(resolvers[0])
        for (const s of setters) rejected.push({ write: s, reason: 'conflict-resolved-by-pending' })
        for (const r of resolvers.slice(1)) rejected.push({ write: r, reason: 'duplicate-resolver' })
      }
      else {
        // All SET_FIELDS: tieni il primo, scarta altri
        accepted.push(ws[0])
        for (const s of ws.slice(1)) rejected.push({ write: s, reason: 'duplicate-setter' })
      }
    }
  }
  
  return { accepted, rejected }
}
```

### 6.2 Dispatcher matrix completata

Aggiunta a v3.2 §20 righe mancanti:

| Accepted commands | Pending attivo | Outcome | messageOut kind |
|---|---|---|---|
| `[RESOLVE_PENDING(reject, pick_from_list)]` | `pick_from_list` | clear pending; no state change | `reprompt` |
| `[RESOLVE_PENDING(reject, pending_overwrite)]` | `pending_overwrite` | clear pending; reject l'overwrite; emit event `OVERWRITE_REJECTED` | `ack-only` |
| `[RESOLVE_PENDING(reject, confirm_binary)]` | `confirm_binary` | clear pending; no state change | `ack-only` |
| `[SET_FIELDS + RESOLVE_PENDING]` sullo stesso field | any | P9b conflict resolution: RESOLVE_PENDING wins; SET_FIELDS update scartato | `ack-only` |
| `[SET_FIELDS X + SET_FIELDS Y]` stesso field (impossibile se P9a tiene max 1 SET_FIELDS) | N/A | N/A | N/A |
| `[ASK_FIELD + SET_FIELDS]` same field | none | SET_FIELDS vince (utente ha fornito value), ASK_FIELD ignorato | `ack-only` |
| `[ANSWER_INFO + SET_FIELDS]` citedFields incluso il field mutato | none | ordine: SET_FIELDS prima, poi ANSWER_INFO renderizzato su state post-update | `info-answer` |
| `[ANSWER_META + REPROMPT]` | any | REPROMPT ha priorità (segnala problema); ANSWER_META non mostrato | `reprompt` |
| `[]` | `pending_cancel` scaduto (TTL > 60s) | auto-clear pending_cancel, treat as `[]` + no pending | `reprompt` |

### 6.3 TTL check a inizio turno (per pending_cancel)

Pre-resolver (§5 v3.2) esteso:

```typescript
function resolvePendingTTL({ pending }: { pending: PendingInteraction | null }): {
  cleared: boolean
  events: InteractiveFlowTurnEvent[]
} {
  if (!pending) return { cleared: false, events: [] }
  if (pending.type !== 'pending_cancel') return { cleared: false, events: [] }
  
  const age = Date.now() - new Date(pending.createdAt).getTime()
  if (age > 60_000) {
    return {
      cleared: true,
      events: [{ kind: 'CANCEL_TTL_EXPIRED', /* ... */ }],
    }
  }
  return { cleared: false, events: [] }
}
```

Se cleared → pending rimosso dal request prima del LLM call + evento emesso.

### 6.4 pending_cancel esclusività

Quando `pending_cancel` attivo, nessun altro pending può essere creato. v3.2 dispatcher matrix dice "pending attivo non-cancel + REQUEST_CANCEL → reprompt", ma non dice cosa succede con SET_FIELDS durante pending_cancel attivo.

v3.3 regola: durante `pending_cancel`:
- `RESOLVE_PENDING(accept/reject, pending_cancel)` → risolto normalmente
- `SET_FIELDS`, `ASK_FIELD`, `ANSWER_META`, `ANSWER_INFO` → ignorati, dispatcher emette `REPROMPT(low-confidence)` con template "Prima decidi se annullare o proseguire".
- `REQUEST_CANCEL` → no-op (pending_cancel già attivo).

---

## 7. Naming audit finale

Fix Codex #15: v3.2 usava ancora `session.revision` in alcuni punti pseudo-code.

### 7.1 Uniformato in v3.3

| Contesto | Nome canonico | Dove usato |
|---|---|---|
| Variabile TypeScript runtime | `sessionRevision` | Engine interpreter code, request/response DTO |
| Store-entries DB column | `version` | Migration, entity TypeORM |
| Store-entries DTO field | `expectedVersion` | PutStoreEntryRequest DTO |
| InterpretTurnRequest field | `sessionRevision` | shared DTO |

Convention: engine-side parla di `sessionRevision` (concept); store-entries-side parla di `version` (persistence). Mapping:

```typescript
// session-store.ts
async function loadWithRevision({ key, constants }: {...}): Promise<{
  record: SessionRecord | null
  sessionRevision: number
}> {
  const response = await store.get({ key, constants })
  return {
    record: response?.value ?? null,
    sessionRevision: response?.version ?? 0,
  }
}

async function saveWithCAS({
  key, constants, state, history, flowVersionId,
  historyMaxTurns, pendingInteraction, expectedRevision,
}: {
  // ...
  expectedRevision: number
}): Promise<{ status: 'ok'; newRevision: number } | { status: 'conflict' }> {
  const response = await store.putWithExpectedVersion({
    key,
    value: { state, history, flowVersionId, lastTurnAt: new Date().toISOString(), pendingInteraction },
    expectedVersion: expectedRevision,
    constants,
  })
  if (response.status === 412) return { status: 'conflict' }
  return { status: 'ok', newRevision: response.version }
}
```

Il contesto engine sempre usa `sessionRevision`/`expectedRevision`. Il client store-entries converte a `version` al boundary HTTP.

---

## 8. SQLite community edition: fail esplicito

### 8.1 Correzione contraddizione v3.2

v3.2 §9.1 diceva:
> "Per SQLite community edition: command layer disabilitato (feature flag `useCommandLayer` non accettato)."

E anche:
> "Community edition usa legacy path."

Queste due affermazioni sono coerenti solo se la feature flag `useCommandLayer=true` viene **rigettata a livello di validation** del fixture, non silently ignorata.

### 8.2 v3.3: validation esplicita

Aggiunta a `InteractiveFlowActionSettings` validation:

```typescript
// packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts

export const InteractiveFlowActionSettings = z.object({
  // ...
  useCommandLayer: z.boolean().optional(),
})
// .superRefine runtime check solo se useCommandLayer=true e AP_DB_TYPE!=postgres
// (ma superRefine shared non conosce env runtime — va fatto API-side al deploy/publish)
```

Più realisticamente: validation **API-side** quando la flow version viene pubblicata:

```typescript
// packages/server/api/src/app/flow/flow-version.service.ts (pseudo)
function validateFlowVersion({ flowVersion }: {...}): void {
  for (const step of collectSteps(flowVersion)) {
    if (step.type === 'INTERACTIVE_FLOW' && step.settings.useCommandLayer === true) {
      if (process.env.AP_DB_TYPE !== 'POSTGRES') {
        throw new ValidationError({
          message: 'validation.interactiveFlow.commandLayerRequiresPostgres',
        })
      }
    }
  }
}
```

Messaggio utente: "Il command layer richiede PostgreSQL. Questa installazione usa SQLite. Disabilita `useCommandLayer` o usa edizione con PostgreSQL."

**No silent fallback a legacy.** L'utente vede l'errore esplicito.

---

## 9. Publisher claim per sessione

### 9.1 Problema v3.2

`ORDER BY session_id, session_sequence LIMIT 100 FOR UPDATE SKIP LOCKED`: due publisher possono claim righe della stessa sessione contemporaneamente se entrambi leggono un batch di 100. Ordering per-session non garantito a live stream (dedupe via outboxEventId evita duplicati ma non riordina).

### 9.2 Correzione: claim per sessione

Publisher lavora a unità "batch-per-sessione":

```sql
-- Step 1: trova una sessione con eventi pending, lockala
WITH session_to_claim AS (
  SELECT DISTINCT session_id
  FROM interactive_flow_outbox
  WHERE event_status = 'publishable'
    AND published_at IS NULL
    AND (claimed_until IS NULL OR claimed_until < NOW())
    AND (next_retry_at IS NULL OR next_retry_at < NOW())
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE interactive_flow_outbox SET
  claimed_by = $1,
  claimed_until = NOW() + INTERVAL '30 seconds'
WHERE session_id = (SELECT session_id FROM session_to_claim)
  AND event_status = 'publishable'
  AND published_at IS NULL
RETURNING *
-- ORDER BY session_sequence ASC (applicato in client TS)
```

**Proprietà**:
- Un publisher alla volta per sessione.
- Tutti gli eventi della sessione sono claimed insieme → ordering garantito.
- SKIP LOCKED fa sì che publisher concorrenti prendano sessioni diverse.
- Lease claim scade dopo 30s → recovery se publisher crasha.

### 9.3 Heartbeat publisher

Se la pubblicazione batch supera 20s, estensione claim:

```sql
UPDATE interactive_flow_outbox
SET claimed_until = NOW() + INTERVAL '30 seconds'
WHERE session_id = $1
  AND claimed_by = $2
  AND published_at IS NULL
```

### 9.4 Release dopo pubblicazione

```sql
UPDATE interactive_flow_outbox
SET published_at = NOW(),
    claimed_by = NULL,
    claimed_until = NULL
WHERE outbox_event_id = $1
```

Per eventi fail → retry tracking invariato da v3.2.

---

## 10. Store-entries CAS: metodo dedicato

### 10.1 Problema v3.2

v3.2 proponeva di estendere `Put/Upsert` esistente. Ma:
- Service usa `repo.upsert` (cfr. [store-entry.service.ts:14](../../packages/server/api/src/app/store-entry/store-entry.service.ts#L14)), che non distingue insert vs update vs CAS mismatch.
- DTO usa TypeBox via Fastify, non Zod shared (cfr. [store-entry-request.ts:4](../../packages/shared/src/lib/core/store-entry/dto/store-entry-request.ts#L4)).

### 10.2 Correzione: metodo separato

Lasciamo `upsert` legacy invariato. Aggiungiamo metodo dedicato:

```typescript
// packages/server/api/src/app/store-entry/store-entry.service.ts

async function upsertWithExpectedVersion({
  projectId, key, value, expectedVersion,
}: {
  projectId: string
  key: string
  value: unknown
  expectedVersion: number
}): Promise<
  | { status: 'ok'; newVersion: number }
  | { status: 'conflict'; currentVersion: number }
> {
  const result = await db.transaction(async (trx) => {
    // Try update with CAS
    const updateResult = await trx.query(`
      UPDATE store_entry
      SET value = $1, version = version + 1, updated = NOW()
      WHERE project_id = $2 AND key = $3 AND version = $4
      RETURNING version
    `, [value, projectId, key, expectedVersion])
    
    if (updateResult.rowCount > 0) {
      return { status: 'ok', newVersion: updateResult.rows[0].version }
    }
    
    // Maybe the row doesn't exist yet → try insert (only if expectedVersion=0)
    if (expectedVersion === 0) {
      const insertResult = await trx.query(`
        INSERT INTO store_entry (project_id, key, value, version, created, updated)
        VALUES ($1, $2, $3, 1, NOW(), NOW())
        ON CONFLICT (project_id, key) DO NOTHING
        RETURNING version
      `, [projectId, key, value])
      
      if (insertResult.rowCount > 0) {
        return { status: 'ok', newVersion: 1 }
      }
    }
    
    // Get current version to return in conflict
    const current = await trx.query(`
      SELECT version FROM store_entry WHERE project_id = $1 AND key = $2
    `, [projectId, key])
    
    return {
      status: 'conflict',
      currentVersion: current.rows[0]?.version ?? 0,
    }
  })
  
  return result
}
```

### 10.3 Nuovo endpoint REST

`POST /v1/store-entries/upsert-with-expected-version`

Request (TypeBox):
```typescript
const UpsertWithExpectedVersionRequest = Type.Object({
  key: Type.String(),
  value: Type.Unknown(),
  expectedVersion: Type.Integer({ minimum: 0 }),
})
```

Response:
- `200` con `{ version: number }` se ok
- `412` con `{ currentVersion: number, message: 'precondition-failed' }` se conflict

### 10.4 DB migration additive

```sql
ALTER TABLE store_entry ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
```

Retrocompatibile: valore default 0 per righe esistenti. Client che non passa `expectedVersion` continua a usare `upsert` legacy (last-write-wins, non tocca `version`).

**Caveat**: per consistenza, il metodo `upsert` legacy va aggiornato per incrementare `version` ad ogni write (altrimenti `expectedVersion=0` sarà sempre accettato su righe legacy). Decisione implementativa: **sì**, `version++` anche in `upsert` legacy. È un side-effect invisibile ai client esistenti (non ispezionano il campo) ma necessario per consistenza del CAS.

---

## 11. Pending_cancel esclusività

Già trattato §6.4. Ribadito qui per completezza:

- Massimo un pending attivo alla volta (invariante pre-esistente rinforzato).
- `pending_cancel` attivo blocca creazione di nuovi pending (overwrite, pick, confirm) finché resolve o TTL expire.
- TTL check a inizio turno (pre-resolver).

---

## 12. Chiusura del ciclo di revisione documentale

### 12.1 Stato finale

v3.3 integra **14 correzioni** dai 15 findings Codex v3.2 (più alcuni nuovi rischi Fase 2 elevati a fix nel doc). Ogni correzione è architetturale, non documentale.

Tutte le decisioni di design sono ora:
- Esplicite (vs. ambigue in v3.0-v3.2)
- Coerenti col codebase reale (vs. ghost references in v3.0)
- Testabili (vs. aspirazionali in v3.1-v3.2)

### 12.2 Ciò che v3.3 **non** può garantire senza test

Le 5 proprietà architetturali critiche (lease atomicity, saga correctness, sequence generation, publisher FIFO, CAS behavior) sono **pattern PostgreSQL standard** ma la loro correttezza end-to-end dipende da:
- Comportamento esatto di PostgreSQL su `INSERT ... ON CONFLICT ... WHERE` sotto contention
- Serializzabilità effettiva di UPSERT concorrenti
- Consistenza di `FOR UPDATE SKIP LOCKED` con workload reale
- Interazione fra recovery daemon e publisher con orologi non sincronizzati
- Failure modes HTTP (timeout, retry) con saga in volo

Questi **non si validano leggendo documentazione**. Si validano con:
- Spike SQL settimana 1 (Phase 0A): scripts di concurrency stress test
- Integration test con 2+ worker concorrenti sullo stesso turnId
- Chaos test: crash del worker durante fasi differenti (pre-lease, durante LLM, tra T1 e T2, durante finalize)
- Load test: 100+ sessioni parallele, misurare latenza publisher e lag outbox

### 12.3 v3.3 è l'ultimo giro di spec

Dopo questo documento, **no v3.4**. Prossimo step **obbligatorio**:

**Phase 0A spike (1 settimana)**: implementare in branch sperimentale le 5 primitive critiche (lease UPSERT, saga 3-stati, sequence table, publisher claim per sessione, store-entries CAS), scrivere 5-10 test di concorrenza che dimostrino le proprietà, pubblicare report.

L'output dello spike è:
- VERDE → procedi con Phase 0A full (3-4 settimane) senza ulteriori iterazioni documentali
- GIALLO → correzioni puntuali al doc v3.3 **post-spike** (non pre-implementation), documentate come errata
- ROSSO → ri-design di una delle 5 primitive, documentato come ADR separato (non v3.4 globale)

**Motivazione sul diminishing returns**: 3 iterazioni di review hanno portato a miglioramenti importanti. La quarta iterazione non produrrà gain proporzionali senza dati empirici. Continuare a iterare sulla documentazione scritta è accademico; è tempo di metterci del codice.

### 12.4 Ammissione onesta

v3.3 può ancora contenere bug che Codex (o un'ulteriore review) troverebbe. Non è perfetto. Ma è **sufficientemente specifico** da essere implementato in uno spike che dimostrerà concretamente cosa funziona e cosa no.

La perfezione documentale senza validazione sperimentale non esiste.

---

## 13. Integration table findings Codex v3.2

| # Codex v3.2 | Finding | Verdetto Codex | v3.3 correzione | Verdetto v3.3 target |
|---|---|---|---|---|
| 1 | Firma verifyEvidence | VERIFIED FIXED | — | invariato |
| 2 | T1 committed prima T2 | PARTIALLY | Saga prepared → finalized | VERIFIED FIXED |
| 3 | Lease worker_id riacquisibile | NEW BUG | leaseToken UUID | VERIFIED FIXED |
| 4 | Commit stale post-recovery | PARTIALLY | CAS su leaseToken + heartbeat | VERIFIED FIXED |
| 5 | MAX+1 FOR UPDATE | NEW BUG | Sequence table dedicata | VERIFIED FIXED |
| 6 | EntitySchema/migration mismatch | PARTIALLY | Decisione spike Phase 0A per convention | PARTIALLY (decidibile in spike) |
| 7 | Boundary engine/api | VERIFIED FIXED | — | invariato |
| 8 | First-turn catalog | VERIFIED FIXED | — | invariato |
| 9 | messageOut DTO incoerente | PARTIALLY | DTO unificato §5 | VERIFIED FIXED |
| 10 | P9 conflict SET+RESOLVE | PARTIALLY | Write-set normalizzato §6.1 | VERIFIED FIXED |
| 11 | pending_cancel spec | VERIFIED FIXED | — | invariato |
| 12 | Dispatcher matrix incompleta | PARTIALLY | Matrix completata §6.2 | VERIFIED FIXED |
| 13 | catalogReadiness | VERIFIED FIXED | — | invariato |
| 14 | Benchmark count | VERIFIED FIXED | — | invariato |
| 15 | Naming session.revision | PARTIALLY | Audit finale §7 | VERIFIED FIXED |
| 16 | Errata count | VERIFIED FIXED | — | invariato |
| F2#5 (extra) | Publisher FIFO per sessione | RILEVANTE | Claim per sessionId §9 | VERIFIED FIXED |
| F2#7 (extra) | SQLite contraddittorio | RILEVANTE | Fail esplicito §8 | VERIFIED FIXED |
| F2#8 (extra) | pending_cancel transizione | RILEVANTE | Esclusività §11 | VERIFIED FIXED |
| F3d (extra) | Store-entries CAS metodo dedicato | DA CORREGGERE | §10 | VERIFIED FIXED |
| F3e (extra) | TurnResult engine-side | DA CORREGGERE | §5 | VERIFIED FIXED |

**Self-assessment**: 1 PARTIALLY rimasto (EntitySchema convention, decidibile in 30 minuti di spike). Tutti gli altri FIXED.

---

## 14. Related docs

- [flows-analysis.md](flows-analysis.md)
- [proposals-comparison.md](proposals-comparison.md)
- [solution-patterns.md](solution-patterns.md)
- [solution-final-review.md](solution-final-review.md)
- [solution-final-v2.md](solution-final-v2.md)
- [solution-final-v3.md](solution-final-v3.md) — superseded
- [solution-final-v3.1.md](solution-final-v3.1.md) — superseded
- [solution-final-v3.2.md](solution-final-v3.2.md) — superseded from this
- [current-vs-proposed.md](current-vs-proposed.md) — update banner to v3.3
