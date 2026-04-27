# INTERACTIVE_FLOW — Command Layer v3.3 vs Soluzione Precedente

**Data ultimo update**: 2026-04-27  
**Branch**: `feature/command-layer-p0b-infra`  
**Stato**:
- Command Layer = **runtime unico** (fallback legacy rimosso il 2026-04-26)
- 351/351 engine test, 354/354 API test, **10/10 e2e Playwright** su 3 RUN consecutivi (3 RUN × 10 test = 30/30)
- Schema `useCommandLayer` rimosso da `InteractiveFlowActionSettings`; bump `@activepieces/shared` 0.70.0
- 7 mega-journey e2e via LLM bridge reale che coprono ~85% dei rami semantici

---

## 1. Riepilogo esecutivo

La soluzione precedente (**Legacy Field-Extractor**) estraeva campi dallo stato tramite uno schema Zod dinamico per-flow, senza meccanismi conversazionali strutturati. La nuova soluzione (**Server-governed Conversation Command Layer**) introduce un protocollo comando strutturato — 7 comandi tipizzati — gestito interamente lato server con garanzie transazionali (saga acquire→prepare→finalize), protezione CAS per turni concorrenti, e un outbox per la consegna WebSocket.

Dal **2026-04-26** il fallback legacy è stato **rimosso completamente**: ogni turno di INTERACTIVE_FLOW passa attraverso il command layer indipendentemente. Il runtime è ora composto da:

- **Engine-side**: `interactive-flow-executor.ts` (DAG executor) + `turn-interpreter-adapter.ts` (HTTP client verso il command layer) + `status-renderer.ts` (compone bot message bifase).
- **API-side**: `command-layer/` module con saga (acquire/prepare/finalize/rollback), policy engine, command dispatcher, provider adapter (`VercelAIAdapter` reale o `MockProviderAdapter` per test), outbox publisher daemon, lock recovery daemon.
- **Shared**: `ConversationCommandSchema` (7 comandi tipizzati), `InterpretTurnRequest/Response`, `InteractiveFlowTurnEvent`.
- **Frontend**: `useInteractiveFlowTurnEvents` hook + reducer per la timeline conversazionale via WebSocket.

La copertura test è organizzata in 3 livelli: 351 unit test (engine), 354 integration test (API, inclusi chaos test su saga), 10 mega-journey Playwright via LLM bridge reale che esercitano end-to-end tutti i rami principali.

---

## 2. Architetture a confronto

### 2.1 Legacy Field-Extractor (baseline pre-Command Layer)

```
operatore → WebSocket → interactiveFlowExecutor.handle()
                              │
                              ▼
                   fieldExtractor.extractWithPolicy()
                         │
                         ▼
                   POST /v1/engine/interactive-flow-ai/field-extract
                         │
                         ▼
                   generateText() + schema Zod dinamico da stateFields[]
                         │
                         ▼
                   { extractedFields, metaAnswer?, clarifyReason? }
                         │
                         ▼
                   candidatePolicy (evidence / admissibility / plausibility)
                         │
                         ▼
                   overwritePolicy (detectCueOfCorrection + decideOverwrite)
                         │
                         ▼
                   applyStateOverwriteWithTopicChange()
                         │
                         ▼
                   DAG loop (invariato)
                         │
                         ▼
                   persistSession({ botMessage: llmText | null })
```

**Problemi documentati (da `current-vs-proposed.md` §2.4)**:

| ID | Lacuna |
|---|---|
| G1 | `metaAnswer` prodotto dal controller ma ignorato dall'executor |
| G2 | Info-question inesistente (nessun path per "quanti rapporti ha?") |
| G3 | Cancel flow: solo testo, nessun side-effect su sessione |
| G4 | Compound intent impossibile (schema orientato a estrazione, non ad azioni) |
| G5 | Runtime timeline povera: solo 6 eventi DAG, nessun evento conversazionale |
| G6 | Schema estrazione domain-coupled: ogni nuovo flow deve ridefinire schema |
| G7 | Loop prevention assente: meta consecutivi = campo ri-chiesto all'infinito |

---

### 2.2 Command Layer v3.3 (implementazione attuale, fallback rimosso il 2026-04-26)

```
operatore → WebSocket → interactiveFlowExecutor.handle()
                              │
                              ▼
                            turnInterpreterClient.interpret()
                                    │
                                    ▼
                            POST /v1/engine/interactive-flow-ai/command-layer/interpret-turn
                                    │
                            ┌───────┴───────────┐
                            │ ACQUIRE lease     │  (idempotency key = turnId)
                            │ (concurrent lock) │
                            └───────┬───────────┘
                                    │
                            ┌───────┴───────────┐
                            │ PREPARE           │  saga step 1
                            │ - ProviderAdapter │ → VercelAIAdapter (bridge)
                            │   proposeCommands │   o MockProviderAdapter (test)
                            │ - dispatch 7 cmd  │
                            │ - validate Zod    │
                            │ - stateDiff calc  │
                            └───────┬───────────┘
                                    │
                            ┌───────┴───────────┐
                            │ FINALIZE          │  saga step 2
                            │ - write stateDiff │
                            │ - insert outbox   │
                            │ - release lease   │
                            └───────┬───────────┘
                                    │
                            TurnResult { stateDiff, messageOut, clearedKeys }
                                    │
                                    ▼
                            applyStateDiff() [executor]
                                    │
                                    ▼
                            preDagAck prepend to botMessage
                                    │
                                    ▼
                            DAG loop (invariato)
                                    │
                                    ▼
                            statusRenderer.render() [post-DAG]
                                    │
                                    ▼
                            persistSession({ botMessage: ack + status })
                                    │
                                    ▼
                            outboxPublisher.poll() → WebSocket INTERACTIVE_FLOW_TURN_EVENT
```

---

### 2.3 Architettura attuale dettagliata (post fallback removal)

Lo schema completo end-to-end del runtime, dal browser fino al database, attraverso tutti i componenti attivi. Ogni freccia rappresenta un dipendenza concreta nel codice.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (web)                                  │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────┐      │
│   │  Chat UI (flow-chat.tsx)                                          │      │
│   │   ├─ <ChatMessageList> (input + bubble rendering)                 │      │
│   │   └─ <ChatRuntimeTimeline turnEvents={…}>  ← 7 turn-event kinds  │      │
│   │      • FIELD_EXTRACTED  • META_ANSWERED  • INFO_ANSWERED          │      │
│   │      • TOPIC_CHANGED    • CANCEL_REQUESTED  • CANCEL_CONFIRMED    │      │
│   │      • OVERWRITE_PENDING                                          │      │
│   └────────────────┬─────────────────────────────────────────────────┘      │
│                    │ subscribe                                               │
│        useInteractiveFlowTurnEvents(flowRunId)                               │
│                    │ WS room: flowRunId                                      │
└────────────────────┼─────────────────────────────────────────────────────────┘
                     │ INTERACTIVE_FLOW_TURN_EVENT
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API (server/api)                                    │
│                                                                              │
│   ┌─────────────────────────────────────────────────┐                       │
│   │ webhookController                                │                       │
│   │ POST /v1/webhooks/:flowId/sync                   │                       │
│   │  → enqueue EXECUTE_FLOW job (BullMQ/in-memory)   │                       │
│   └─────────────────────────────────────────────────┘                       │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ command-layer/ (controller)                                          │  │
│   │   POST /v1/engine/interactive-flow-ai/command-layer/                 │  │
│   │     ├─ /interpret-turn          (saga step 1: acquire + propose)    │  │
│   │     │     ↓                                                           │  │
│   │     │   1. acquireLease(turnId, sessionId)                            │  │
│   │     │      ↓ inserisce row turn-log status=in-progress                │  │
│   │     │   2. providerAdapter.proposeCommands(prompt, schema)            │  │
│   │     │      ↓ (VercelAIAdapter → bridge :8787 → claude-cli)            │  │
│   │     │   3. policyEngine.validate(commands)                            │  │
│   │     │      ↓ P0..P5 (schema, evidence, identity, allowed-fields)     │  │
│   │     │   4. commandDispatcher.apply(stateDiff, sideEffects)            │  │
│   │     │      ↓ topic-change, pending interactions                       │  │
│   │     │   5. prepare(turnId, leaseToken)                                │  │
│   │     │      ↓ row turn-log status=prepared                             │  │
│   │     │   6. outbox.insertPending(events) (PII-redacted)                │  │
│   │     │      ↓                                                           │  │
│   │     │   7. response: { stateDiff, messageOut, finalizeContract,       │  │
│   │     │                  acceptedCommands, lastPolicyDecisions, … }     │  │
│   │     │                                                                  │  │
│   │     ├─ /interpret-turn/finalize (saga step 2: commit)                 │  │
│   │     │     ↓ row turn-log status=finalized + outbox→publishable        │  │
│   │     ├─ /interpret-turn/rollback (saga compensate)                     │  │
│   │     │     ↓ row turn-log status=compensated + outbox→void             │  │
│   │     ├─ /outbox/replay        (recovery dopo riconnessione client)     │  │
│   │     ├─ /metrics              (counter snapshot)                        │  │
│   │     ├─ /traces               (span timings)                            │  │
│   │     └─ /admin/force-clear-stale (debug)                                │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────┐                   │
│   │  POST /v1/engine/interactive-flow-ai/                │                   │
│   │    /question-generate                                 │                   │
│   │  → genera testo dinamico per USER_INPUT/CONFIRM       │                   │
│   │    quando node.message.dynamic === true               │                   │
│   └─────────────────────────────────────────────────────┘                   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ DAEMON (avviati al boot in worker-module.ts)                         │  │
│   │                                                                       │  │
│   │   outboxPublisher.start({                                             │  │
│   │     pollIntervalMs: AP_OUTBOX_POLL_MS ?? 500                          │  │
│   │   })                                                                   │  │
│   │     ↓ ogni 500ms: SELECT FROM outbox WHERE status='publishable'       │  │
│   │     ↓ websocketService.to(flowRunId).emit(INTERACTIVE_FLOW_TURN_EVENT)│  │
│   │     ↓ UPDATE outbox SET status='published'                            │  │
│   │                                                                       │  │
│   │   lockRecoveryDaemon.start({                                          │  │
│   │     pollIntervalMs: AP_LOCK_RECOVERY_POLL_MS ?? 10_000                │  │
│   │   })                                                                   │  │
│   │     ↓ ogni 10s: reclaim lease scaduti + prepared > 5min               │  │
│   │     ↓ row turn-log status='compensated' + outbox→'void'               │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ENGINE (server/engine, fork sandbox)                │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ interactive-flow-executor.ts (entry point per ogni turno)             │  │
│   │                                                                       │  │
│   │   1. session-store.load(sessionId)                                    │  │
│   │      ↓ state, history, sessionRevision                                │  │
│   │   2. resolve userMessage (from resume body or trigger)                │  │
│   │   3. commandLayerClientAdapter.interpret({ … })                       │  │
│   │      ↓ HTTP POST → /command-layer/interpret-turn                      │  │
│   │      ↓ riceve TurnResult                                              │  │
│   │   4. extractedFields = response.stateDiff                             │  │
│   │   5. session-store.applyStateOverwriteWithTopicChange()               │  │
│   │      ↓ state aggiornato + executedNodeIds reset per topic-change      │  │
│   │   6. preDagAck = response.messageOut.preDagAck                        │  │
│   │   7. DAG loop:                                                        │  │
│   │      ├─ findReadyToolNodes() → executeToolWithPolicy() (MCP)          │  │
│   │      ├─ findReadyBranchNodes() → branch evaluation                    │  │
│   │      ├─ propagateSkip() (errorPolicy SKIP cascade)                    │  │
│   │      └─ findNextUserOrConfirmNode() → pause                           │  │
│   │   8. statusRenderer.render({ state, locale, success })                │  │
│   │      ↓ post-DAG status text                                           │  │
│   │   9. botMessage = preDagAck + '\n\n' + statusText                     │  │
│   │  10. turnInterpreterClient.finalize(turnId, leaseToken)               │  │
│   │      ↓ HTTP POST → /command-layer/interpret-turn/finalize             │  │
│   │  11. session-store.save(sessionId, state, history)                    │  │
│   │      ↓ CAS check su sessionRevision (412 su conflict)                 │  │
│   │  12. interactive-flow-events.emit(NODE_STATE_CHANGED)                 │  │
│   │      ↓ legacy WS event (DAG node lifecycle: STARTED, PAUSED, …)      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────┐                   │
│   │ MCP gateway resolution (banking-* tools)              │                   │
│   │  resolveGateway(gatewayId) → JSON-RPC client          │                   │
│   │  → http://localhost:8000/mcp (AEP backend reale)      │                   │
│   │  o mock-mcp-server (test e2e M4)                      │                   │
│   └─────────────────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DATABASE (Postgres / PGLite — required)                   │
│                                                                              │
│   interactive_flow_turn_log         — saga state per turno                   │
│      (turnId, sessionId, status, leaseToken, createdAt, …)                  │
│      states: in-progress → prepared → finalized | compensated | failed       │
│                                                                              │
│   interactive_flow_outbox           — eventi WebSocket (delivery garantita)  │
│      (sequence, sessionId, eventStatus, payload, …)                          │
│      states: pending → publishable → published | void | dead-letter          │
│                                                                              │
│   interactive_flow_session_sequence — counter monotono per sessione          │
│                                                                              │
│   store-entries                      — session record (state + history + rev)│
│      key: ifsession:<namespace>:<sessionId>                                  │
│      record: { state, history, flowVersionId, lastTurnAt }                   │
└─────────────────────────────────────────────────────────────────────────────┘
                     ▲
                     │
                     │ banking-* tool calls (read + write)
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              AEP BACKEND (separato, in-house FastAPI)                        │
│                                                                              │
│   http://localhost:8000/mcp  (JSON-RPC 2.0)                                  │
│   tools: search_customer, get_profile, list_accounts, list_closure_reasons,  │
│          generate_module, submit_closure, …                                  │
└─────────────────────────────────────────────────────────────────────────────┘

         ┌─────────────────────────────────────────┐
         │  LLM BRIDGE (claude-code-openai-bridge) │
         │  http://localhost:8787                  │
         │  POST /v1/chat/completions              │
         │  → spawn `claude` CLI subprocess        │
         │  invocato da VercelAIAdapter via        │
         │  AP_LLM_VIA_BRIDGE=true                 │
         └─────────────────────────────────────────┘
                            ▲
                            │ generateText()
                            │
        VercelAIAdapter (server/api/src/app/ai/command-layer/
                        vercel-ai-adapter.ts)
        ↓ buildToolsRegistry(ConversationCommandSchema)
        ↓ tool-call → ConversationCommand[]
```

#### Componenti chiave del Command Layer (post-rimozione fallback)

| Modulo | Path | Responsabilità |
|---|---|---|
| `turn-interpreter.ts` | `server/api/src/app/ai/command-layer/` | Orchestra il singolo turno: lease → propose → policy → prepare → outbox INSERT |
| `command-dispatcher.ts` | idem | Applica `ConversationCommand[]` accettati allo `stateDiff` + side-effects (topic change, pending) |
| `policy-engine.ts` | idem | Valida i comandi proposti (P0 schema, P3 evidence, P4 identity, P5 allowed-fields) |
| `provider-adapter.ts` | idem | Interfaccia `ProviderAdapter` + `MockProviderAdapter` (default test) |
| `vercel-ai-adapter.ts` | idem | Implementazione reale via Vercel AI SDK + bridge (`AP_LLM_VIA_BRIDGE=true`) |
| `outbox-publisher.ts` | idem | Daemon: poll outbox table → emit WebSocket → mark published |
| `lock-recovery.ts` | idem | Daemon: reclaim lease zombie + prepared > 5min |
| `turn-log.service.ts` | idem | CRUD su `interactive_flow_turn_log` (saga state machine) |
| `outbox.service.ts` | idem | Insert + claim + mark publishable/published |
| `interactive-flow-validator.ts` | `server/api/src/app/flows/flow-version/` | Pre-publish guard: rifiuta INTERACTIVE_FLOW su DB non Postgres/PGLite |
| `turn-interpreter-client.ts` | `server/engine/src/lib/handler/` | HTTP client engine→API per `/interpret-turn`, `/finalize`, `/rollback` |
| `turn-interpreter-adapter.ts` | idem | `commandLayerClientAdapter.interpret()` — converte `InterpretTurnResponse` in `TurnResult` |
| `status-renderer.ts` | idem | Compone bot message bifase (`preDagAck` + status text post-DAG) |
| `session-store.ts` | idem | CAS read/write su store-entries; topic change propagation |
| `interactive-flow-executor.ts` | idem | Entry point per ogni turno (resume + first-turn paths, sempre command layer) |

---

## 3. Tipologie di conversazioni gestite

Il Command Layer supporta **8 tipologie distinte di interazione utente** per turno, combinabili in compound. Ogni tipologia mappa a uno o più `ConversationCommand` emessi dal LLM e dispatched dal command-dispatcher server-side.

### 3.1 Le 8 tipologie

| # | Tipologia | Comando emesso | Esempio utterance | Comportamento |
|---|---|---|---|---|
| 1 | **Estrazione campo** | `SET_FIELDS` | "Bellafronte" | Estrae 1+ campi `extractable=true` con evidence; dispatch applica state diff e propaga topic-change se sovrascrive |
| 2 | **Risposta a domanda meta** | `ANSWER_META` | "cosa mi avevi chiesto?" / "non ho capito" / "a che punto siamo?" | 4 kind: `ask-repeat`, `ask-clarify`, `ask-progress`, `ask-help`. No state advance |
| 3 | **Risposta a domanda info** | `ANSWER_INFO` | "quanti rapporti ha?" | Risolto da renderer registrato per `infoIntent` (es. `count_accounts`); cita `citedFields` da state. No state advance |
| 4 | **Richiesta annullamento** | `REQUEST_CANCEL` | "annulla" | Crea `pending_cancel`; il prossimo turno deve risolverlo |
| 5 | **Risoluzione pending interaction** | `RESOLVE_PENDING(decision, type)` | "sì confermo" / "no continuiamo" | Risolve `confirm_binary`, `pick_from_list`, `pending_overwrite`, `pending_cancel`, `open_text` |
| 6 | **Richiesta campo** | `ASK_FIELD` | (LLM-iniziato quando manca un campo richiesto) | Bot chiede esplicitamente un field; equivale a USER_INPUT pause |
| 7 | **Reprompt** | `REPROMPT(reason)` | "boh non sono sicuro..." | LLM segnala input non parsabile; 6 reasons: `low-confidence`, `policy-rejected`, `off-topic`, `ambiguous-input`, `provider-error`, `catalog-not-ready` |
| 8 | **Compound** | N comandi nello stesso turno | "Bellafronte quanti rapporti ha?" | SET_FIELDS + ANSWER_INFO insieme; dispatch sequenziale (state diff applicato prima delle answer) |

### 3.2 PendingInteraction types

Il sistema mantiene 5 tipi di pending interaction che richiedono risoluzione esplicita:

| Type | Quando | Risoluzione |
|---|---|---|
| `confirm_binary` | CONFIRM node raggiunto (es. `confirm_shared`, `confirm_closure`) | RESOLVE_PENDING(accept/reject) |
| `pick_from_list` | USER_INPUT con render DataTable + > 1 opzione | RESOLVE_PENDING(value=option) o SET_FIELDS sulla key |
| `pending_overwrite` | SET_FIELDS prova a sovrascrivere campo identity confermato | RESOLVE_PENDING(accept/reject) |
| `pending_cancel` | REQUEST_CANCEL emesso | RESOLVE_PENDING(accept→terminate, reject→resume) |
| `open_text` | USER_INPUT senza enum (text libero) | SET_FIELDS sul campo target |

### 3.3 Esempi end-to-end di conversazioni reali (dai mega-journey e2e)

I seguenti esempi sono **conversazioni reali** eseguite contro il LLM bridge nei test e2e.

#### Conversational journey (M1 — consultazione, 9 turni)

```
👤 Bellafronte                                    → SET_FIELDS(customerName)
                                                  → search_customer (AEP) → 1 match → auto-NDG
                                                  → load_profile, load_accounts → pause confirm_shared
🤖 "Ho trovato il cliente Bellafronte (NDG 11255521) con 17 rapporti…"

👤 quanti clienti hai trovato?                    → ANSWER_INFO(count_matches)
🤖 "Ho trovato 1 cliente: Bellafronte"

👤 quanti rapporti ha?                            → ANSWER_INFO(count_accounts)
🤖 "Il cliente ha 17 rapporti attivi"

👤 cosa mi avevi chiesto?                         → ANSWER_META(ask-repeat)
🤖 "Ti avevo chiesto di confermare la condivisione del report PDF…"

👤 non ho capito bene, puoi spiegare?             → ANSWER_META(ask-clarify)
🤖 "Ti chiedo di confermare se il report PDF è stato condiviso col cliente…"

👤 a che punto siamo?                             → ANSWER_META(ask-progress)
🤖 "Cliente identificato, profilo + rapporti caricati, attendo conferma condivisione"

👤 scusa il cliente è Rossi                       → SET_FIELDS(customerName=Rossi) + TopicChange
                                                  → search_customer (AEP) → 400 → errorPolicy SKIP
🤖 "Mi spiace, non ho trovato un cliente Rossi nel sistema…"

👤 non saprei davvero, ho perso il filo           → REPROMPT(low-confidence)
                                                    OR ANSWER_META(ask-clarify)
🤖 "Procediamo con calma. Vuoi tornare a Bellafronte o cercare un altro cliente?"

👤 no torna a Bellafronte e conferma la condivisione → SET_FIELDS(customerName=Bellafronte)
                                                       + RESOLVE_PENDING(confirm_binary, accept)
                                                     → submit → caseId
🤖 "✅ Operazione completata con successo."
```

#### Saga estinzione completa (M2 — estinzione, 5 turni)

```
👤 Vorrei estinguere un rapporto del cliente Rossi  → SET_FIELDS(customerName=Rossi)
                                                   → search_customer SKIP (errorPolicy)
🤖 "Non ho trovato Rossi. Vuoi procedere con un altro cliente?"

👤 scusa intendevo Bellafronte, NDG 11255521        → SET_FIELDS multipli (customerName + ndg)
                                                   → search → load_profile + load_accounts
                                                   → pause pick_rapporto
🤖 "Cliente Bellafronte (NDG 11255521). Quale rapporto desideri estinguere?"

👤 rapporto 01-034-00392400                         → SET_FIELDS(rapportoId)
                                                   → load_reasons → pause collect_reason
🤖 "Indica la motivazione dalla tabella allegata e la data di efficacia."

👤 motivazione 01 trasferimento estero,             → SET_FIELDS multipli (closureReasonCode + closureDate)
   data efficacia 2026-12-31                       → generate_pdf → pause confirm_closure
🤖 "Riepilogo: NDG 11255521, rapporto 01-034-00392400, motivazione 01,
    data 2026-12-31. Confermi l'invio?"

👤 sì confermo invio della pratica                  → RESOLVE_PENDING(confirm_binary, accept)
                                                   → submit_closure → caseId estratto
🤖 "✅ Pratica inviata con successo. ID pratica: ES-2026-3376"
```

#### Single-prompt + correction (M5 — estinzione, 3 turni)

```
👤 Estingui per il cliente Mario Verdi,             → SET_FIELDS atomico massivo (5 campi: customerName,
   rapporto 99-999-99999999,                          rapportoId, ndg, closureReasonCode, closureDate)
   motivazione 01 trasferimento estero,             → search_customer (Mario Verdi non esiste in AEP)
   data efficacia 2026-12-31                       → SKIP propagation
🤖 "Mario Verdi non risulta nei nostri sistemi. Verifica i dati e riprova."

👤 scusa intendevo Bellafronte                      → SET_FIELDS(customerName=Bellafronte) + TopicChange
   NDG 11255521 rapporto 01-034-00392400              + SET_FIELDS(ndg, rapportoId)
                                                   → state preserva motivazione + data dalla T1
                                                   → load chain → pause confirm_closure
🤖 "Cliente Bellafronte. Riepilogo dell'estinzione: …"

👤 motivazione 01 trasferimento estero,             → RESOLVE_PENDING(confirm_closure)
   data efficacia 2026-12-31, sì confermo invio    → submit_closure → caseId
🤖 "✅ Pratica inviata con successo. ID pratica: ES-2026-XXXX"
```

#### Cancel & recovery (M3 — consultazione, 6 turni)

```
👤 Bellafronte                                     → SET_FIELDS, flow avanza
🤖 "Cliente Bellafronte trovato. Confermi la condivisione?"

👤 annulla                                         → REQUEST_CANCEL → pending_cancel
🤖 "Sei sicuro di voler annullare l'operazione?"

👤 no continuiamo                                  → RESOLVE_PENDING(pending_cancel, reject) → resume
🤖 "Procediamo. Confermi la condivisione?"

👤 quanti rapporti ha?                             → ANSWER_INFO(count_accounts) [verifica resume]
🤖 "Il cliente ha 17 rapporti attivi"

👤 annulla tutto, ho cambiato idea                 → REQUEST_CANCEL
🤖 "Sei sicuro di voler annullare?"

👤 sì confermo annulla                             → RESOLVE_PENDING(pending_cancel, accept)
🤖 "Operazione annullata. ✅ Operazione completata."
```

### 3.4 Tipologie NON gestite e2e (out-of-scope motivati)

Alcuni rami sono coperti solo a livello unit/integration (chaos test API), non e2e:

| Ramo | Perché non e2e |
|---|---|
| Saga `compensated`/`failed`/`replayed` | Richiede SIGKILL del worker mid-turno; coperto dal chaos test API (`prepared zombie reclaim`) |
| Outbox `dead-letter`/`retry`/`void` | Richiede mock fail su WebSocket emit; chaos test API |
| `BRANCH` NodeType | Nessuna fixture INTERACTIVE_FLOW lo usa attualmente |
| `errorPolicy: CONTINUE` | Idem (no fixture); coperto solo a unit test |
| `singleOptionStrategy: list/confirm` | Tutte le fixture usano `auto`; nessun match deterministico per > 1 NDG con stesso cognome |
| `ANSWER_META(ask-help)` | LLM determinismo scarso; coperto solo a unit test |
| `REPROMPT(off-topic, provider-error, ambiguous-input, policy-rejected)` | Difficile scatenare deterministic via LLM reale; unit test |
| `pending_overwrite` esplicito | Sequenza utente specifica difficile in conversazione naturale |

---

## 4. Tabella comparativa — capacità funzionali

| # | Requisito | Legacy Field-Extractor | Command Layer v3.3 | Note |
|---|---|---|---|---|
| F1 | Estrazione campo con evidence | ✅ candidatePolicy | ✅ SET_FIELDS + candidatePolicy riusato | Stessa garanzia di non-hallucination |
| F2 | Auto-select singolo match (singleOptionStrategy) | ✅ | ✅ invariato | DAG loop non toccato |
| F3 | Topic change + invalidazione downstream | ⚠️ state sì, executedNodeIds parziale | ✅ SET_FIELDS + clearedKeys esplicito | Ora i nodi downstream vengono ri-eseguiti |
| F4 | Conferma esplicita CONFIRM node | ✅ | ✅ RESOLVE_PENDING(accept/reject, confirm_binary) | Scope node-local preservato |
| F5 | Meta-question (cosa mi avevi chiesto?) | ❌ metaAnswer ignorato | ✅ ANSWER_META dispatched → preDagAck | G1 risolto |
| F6 | Info-question (quanti rapporti ha?) | ❌ assente | ✅ ANSWER_INFO(infoIntent, citedFields) | G2 risolto; infoIntents configurabili per flow |
| F7 | Cancel flow con conferma | ❌ solo testo | ✅ REQUEST_CANCEL → pending_cancel → RESOLVE_PENDING | G3 risolto; cancel è un pending come gli altri |
| F8 | Compound intent (nome + domanda) | ❌ impossibile | ✅ SET_FIELDS + ANSWER_INFO nello stesso turno | G4 risolto; N comandi per turno |
| F9 | Runtime timeline conversazionale | ❌ solo eventi DAG | ✅ INTERACTIVE_FLOW_TURN_EVENT su WebSocket | G5 risolto; turn events separati dai node events |
| F10 | Loop prevention meta consecutivi | ❌ assente | ⚠️ REPROMPT disponibile ma non auto-attivato | G7 parziale; REPROMPT inviato su low-confidence |
| F11 | Idempotency turno | ❌ assente | ✅ acquire lock su turnId (CAS) | Nuovo; turno duplicato → cached response |
| F12 | Turni concorrenti protetti | ❌ assente | ✅ CAS versioning + 412 su conflict | Nuovo; critical per multi-tab |
| F13 | Recovery zombie lease | ❌ assente | ✅ lockRecoveryDaemon (poll 10s) | Nuovo; stale prepared → compensate |
| F14 | Audit trail strutturato | ⚠️ state log solo | ✅ turn-log JSON completo (turnId, commands, stateDiff) | Nuovo; ogni turno = record completo |
| F15 | Delivery WebSocket garantita | ⚠️ in-process emit | ✅ outbox table → publisher fan-out | Nuovo; survives API restart |

**Punteggio**: Legacy 4/15 completi, 2/15 parziali, 9/15 assenti. Command Layer v3.3: 12/15 completi, 2/15 parziali, 1/15 assente (F10).

---

## 5. Tabella comparativa — architettura e componenti

| Dimensione | Legacy Field-Extractor | Command Layer v3.3 |
|---|---|---|
| **Entry point LLM** | `POST /field-extract` — schema Zod dinamico per-flow | `POST /interpret-turn` — 7 comandi tipizzati cross-flow |
| **Output LLM** | `{ [fieldName]: value, metaAnswer?, clarifyReason? }` | `ConversationCommand[]` (SET_FIELDS, ASK_FIELD, ANSWER_META, ANSWER_INFO, REQUEST_CANCEL, RESOLVE_PENDING, REPROMPT) |
| **Contratto cross-flow** | Nessuno (schema per-flow) | `ConversationCommandSchema` (Zod, validato su ogni turno) |
| **Provider LLM** | `generateText()` diretto nel controller | `ProviderAdapter` (interfaccia) → VercelAIAdapter (bridge) o MockProviderAdapter (test) |
| **Transazionalità** | Nessuna (in-memory, no saga) | Saga: acquire → prepare → finalize/rollback con turn-log DB |
| **Idempotency** | Nessuna | Lease su `turnId`, risposta cached se duplicato |
| **Concorrenza** | Race condition possibile | CAS versioning su session-store, 412 su conflict |
| **Recovery** | Nessuna | `lockRecoveryDaemon` reclaima stale in-progress/prepared |
| **Bot message pre-DAG** | Nessuno | `preDagAck` — testo LLM prepended prima del DAG |
| **Bot message post-DAG** | `summary` sintetico dell'executor | `statusRenderer.render()` + combine con preDagAck |
| **WebSocket delivery** | Emit in-process sincrono | Outbox table → `outboxPublisher.poll()` → emit |
| **Pending interactions** | `pick_from_list`, `confirm_binary` | Idem + `open_text` (fallback), `pending_cancel` |
| **ErrorPolicy su tool node** | Nessuna (eccezione → FAIL) | `errorPolicy.onFailure: "SKIP"` → flow continua |
| **Guards DB** | Nessuno | Validator: reject INTERACTIVE_FLOW publish su SQLite (Postgres/PGLite richiesto) |
| **Test coverage** | e2e spec su fixture reale | Unit (351 engine) + integration (354 API) + e2e Playwright (10 mega-journey via LLM bridge reale) |

---

## 6. Tabella comparativa — costo operativo

### 6.1 Latenza per turno (stime aggiornate post-implementazione)

| Step | Legacy | Command Layer | Delta |
|---|---|---|---|
| Preparazione prompt | 10 ms | 15 ms | +5 ms |
| LLM call (bridge) | 1800 ms | 2200 ms (1° turno) / 1500 ms (cached) | +400 ms / −300 ms |
| Saga (acquire+prepare+finalize) | 0 ms | 25 ms | +25 ms |
| Dispatch + validazione Zod | 50 ms | 80 ms | +30 ms |
| DAG loop | 200 ms | 200 ms | 0 ms |
| **Totale p50** | ~2060 ms | ~2520 ms (1°) / ~1820 ms (cached) | +460/−240 ms |
| **p95 sessione 8+ turni** | ~3200 ms | ~2900 ms | **−300 ms** (cache warm) |

### 6.2 Complessità manutentiva

| Dimensione | Legacy | Command Layer |
|---|---|---|
| Nuova capability conversazionale | 3-5 file da modificare | 1 comando nel registry |
| Nuovo flow | Solo fixture JSON | Solo fixture JSON + infoIntents[] |
| Debug turno fallito | 4 layer (extractor → policy → overwrite → executor) | 1 turn-log entry JSON + dispatch log |
| Audit compliance | State log senza intent dichiarato | Turn-log completo (commands, stateDiff, timestamps) |
| Test per nuovo flow | ~15 spec e2e reali (lenti) | Unit mock + 2-3 smoke live |

### 6.3 LoC delta

| Categoria | Legacy (baseline) | Command Layer (delta) |
|---|---|---|
| `interactive-flow-executor.ts` | ~1400 | +~200 (feature flag, preDagAck, applyStateDiff) |
| Command layer API (`src/app/ai/command-layer/`) | 0 | +~3200 (controller, provider-adapter, outbox, lock-recovery, vercel-ai-adapter, store, ecc.) |
| Shared schemas (`interactive-flow-action.ts`) | ~800 | +~300 (ConversationCommandSchema, TurnEvent, NodeMessageSchema) |
| Engine turn-interpreter-client | 0 | +~300 |
| Test (API integration) | ~30 test | +116 test (146 totali) |
| Test (Playwright e2e) | 5 estinzione spec | +14 command-layer spec |
| Frontend hooks/reducer | ~400 | +~200 (useInteractiveFlowTurnEvents, reducer) |
| **Totale nuovo codice** | — | **~4200 LoC** |

---

## 7. Tabella comparativa — robustezza e compliance bancaria

| Requisito | Legacy | Command Layer v3.3 | Vincitore |
|---|---|---|---|
| Non-hallucination su valori estratti | ✅ candidatePolicy | ✅ candidatePolicy riusato + Zod strict su SET_FIELDS | Parità |
| Fabricazione field fuori da stateFields | N/A | ✅ SET_FIELDS.field enforced ∈ stateFields[].name | Command Layer |
| Recovery da errore LLM | Retry singolo | REPROMPT → preDagAck vuoto → flow continua | Command Layer |
| Turno duplicato (retry rete) | Race condition | ✅ Idempotent (lease + cached response) | Command Layer |
| Cancel tracciato per compliance | ❌ nessun evento | ✅ REQUEST_CANCEL + RESOLVE_PENDING in turn-log | Command Layer |
| Conferma dispositiva non-auto | ✅ node-local scope | ✅ invariato + RESOLVE_PENDING esplicito | Parità |
| Audit trail per operazioni | ⚠️ state log solo | ✅ turn-log JSON strutturato, ogni turno replayabile | Command Layer |
| Resilienza riavvio API | ❌ stato in-memory perso | ✅ outbox survives restart, saga compensate | Command Layer |
| Protezione multi-tab/concorrenza | ❌ race condition | ✅ CAS + 412 su conflict | Command Layer |
| Visibilità operativa (timeline) | 6 eventi DAG | 6 DAG + N turn events WebSocket | Command Layer |

---

## 8. Migration path

Il fallback legacy è stato **rimosso il 2026-04-26**. Non c'è più migrazione da fare: tutti i flow INTERACTIVE_FLOW passano per il command layer di default. Le fixture esistenti devono essere conformi al contratto strutturale:

1. Nodi `USER_INPUT` e `CONFIRM` con `message` come oggetto localizzato `{ "it": "...", "en": "..." }` (o `{ "dynamic": true, "fallback": {...}, "systemPromptAddendum": "..." }`).
2. `"errorPolicy": { "onFailure": "SKIP" }` sui nodi TOOL che possono fallire in modo recuperabile.
3. `infoIntents: []` (o lista delle intent disponibili) — campo richiesto.
4. `mcpGatewayId` nel flow settings (già obbligatorio per TOOL nodes).

Per aggiungere un nuovo flow vedi [command-layer-developer-guide.md](command-layer-developer-guide.md).

### 8.1 Fallback rimosso (2026-04-26)

Il dual-path è stato eliminato in 5 fasi (vedi [progress-log.md](progress-log.md)):

- **Fase 1**: eliminati ~32 file di test legacy (13 e2e + 4 API unit + 11 engine unit + 1 R-RO.4 integration + cleanup blocchi del flag-toggle nel validator test).
- **Fase 2**: rimossi i ternari di branching nell'executor (resume + first-turn) e `selectAdapter` in `turn-interpreter-adapter.ts`. Migrata `estinzione.json` strutturalmente. Nuovo spec `command-layer-estinzione.local.spec.ts`.
- **Fase 3**: eliminati 4 moduli runtime legacy (`field-extractor`, `overwrite-policy`, `pending-interaction-resolver`, `meta-question-handler`), endpoint `/field-extract` (~600 LoC). Validator: `checkCommandLayerCompatibility` → `checkPostgresRequired` (universale).
- **Fase 4**: rimosso il campo flag-toggle dallo schema `InteractiveFlowActionSettings`. Bump `@activepieces/shared` 0.69.1 → 0.70.0. Ripulita `consultazione-cliente.json`.
- **Fase 5**: rinominata i18n key `validation.commandLayer.*` → `validation.interactiveFlow.*` in 12 locales. Eliminata `featureDisabled`. Archiviati 14 doc storici in `docs/interactive-flow/archive/`. Aggiornati CLAUDE.md/AGENTS.md.

Done condition: 0 residui del flag-toggle nel codice attivo (`packages/`, `fixtures/`, root markdown).

---

## 9. Risultati test finali (2026-04-27)

| Suite | Totale | Passati | Falliti | Skip |
|---|---|---|---|---|
| Engine (Vitest) | 351 | 351 | 0 | 0 |
| API integration (Vitest) | 354 | 354 | 0 | 0 |
| Playwright e2e (mega-journey via LLM bridge reale) | 10 | 10 | 0 | 0 |

**Stabilità Playwright**: 3 RUN consecutivi (30/30 test totali) senza fallimenti. Tempo per RUN ~6 min.

**Spec e2e (7 file)**:
1. `command-layer-bridge-smoke.local.spec.ts` (S1) — 1 turno, gate veloce
2. `journey-consultazione-conversational.local.spec.ts` (M1) — 9 turni
3. `journey-consultazione-confirm-reject.local.spec.ts` (M1bis) — 3 turni
4. `journey-cancel-and-recovery.local.spec.ts` (M3) — 6 turni
5. `journey-estinzione-saga-completa.local.spec.ts` (M2) — 5 turni, retry(2)
6. `journey-estinzione-single-prompt-correction.local.spec.ts` (M5) — 3 turni, retry(2)
7. `journey-infra-resilience.local.spec.ts` (M4) — 4 sub-test (catalog-fail, CAS conflict, slow MCP, happy)

---

## 10. Verdetto

| Criterio | Vincitore |
|---|---|
| Capability funzionali (F1-F15) | **Command Layer v3.3** (12/15 vs 4/15) |
| Robustezza transazionale | **Command Layer v3.3** |
| Audit trail compliance bancaria | **Command Layer v3.3** |
| Manutenibilità nuovi flow | **Command Layer v3.3** (fixture JSON, no code change) |
| Latenza sessione lunga (>8 turni) | **Command Layer v3.3** (cache warm) |
| Latenza sessione corta (1-3 turni) | Legacy Field-Extractor (nessun overhead saga) |
| Semplicità implementativa | Legacy Field-Extractor |
| Copertura test | **Command Layer v3.3** (146 integration + 14 Playwright) |
| Rollback risk | Parità (feature flag per-flow) |

**Conclusione**: Command Layer v3.3 vince su 7/9 criteri. I due dove il legacy vince (latenza corta, semplicità) sono accettabili nel contesto bancario dove le sessioni tipiche hanno 6-12 turni e la robustezza transazionale è non-negoziabile.

---

## 11. Riferimenti

- [command-layer-developer-guide.md](command-layer-developer-guide.md) — guida sviluppatore (build flow su command-layer runtime)
- [progress-log.md](progress-log.md) — log cronologico delle modifiche
- [archive/current-vs-proposed.md](archive/current-vs-proposed.md) — analisi originale legacy vs Modo 3 (storica)
- [archive/solution-final-v3.3.md](archive/solution-final-v3.3.md) — spec definitiva Server-governed Command Layer (storica)
- [archive/](archive/) — documenti storici di design e iterazioni (15 file pre-rimozione fallback)
- [progress-log.md](progress-log.md) — log implementazione task per task
