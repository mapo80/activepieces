# INTERACTIVE_FLOW — Command Layer v3.3 vs Soluzione Precedente

**Data**: 2026-04-26  
**Branch**: `feature/command-layer-p0b-infra`  
**Stato**: Command Layer implementato, 14/15 Playwright spec verdi, 423 engine test, 146 API test.

---

## 1. Riepilogo esecutivo

La soluzione precedente (**Legacy Field-Extractor**) estraeva campi dallo stato tramite uno schema Zod dinamico per-flow, senza meccanismi conversazionali strutturati. La nuova soluzione (**Server-governed Conversation Command Layer**) introduce un protocollo comando strutturato — 7 comandi tipizzati — gestito interamente lato server con garanzie transazionali (saga acquire→prepare→finalize), protezione CAS per turni concorrenti, e un outbox per la consegna WebSocket.

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

## 3. Tabella comparativa — capacità funzionali

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

## 4. Tabella comparativa — architettura e componenti

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
| **Test coverage** | e2e spec su fixture reale | Unit + integration (146 API) + e2e Playwright (14 spec) |

---

## 5. Tabella comparativa — costo operativo

### 5.1 Latenza per turno (stime aggiornate post-implementazione)

| Step | Legacy | Command Layer | Delta |
|---|---|---|---|
| Preparazione prompt | 10 ms | 15 ms | +5 ms |
| LLM call (bridge) | 1800 ms | 2200 ms (1° turno) / 1500 ms (cached) | +400 ms / −300 ms |
| Saga (acquire+prepare+finalize) | 0 ms | 25 ms | +25 ms |
| Dispatch + validazione Zod | 50 ms | 80 ms | +30 ms |
| DAG loop | 200 ms | 200 ms | 0 ms |
| **Totale p50** | ~2060 ms | ~2520 ms (1°) / ~1820 ms (cached) | +460/−240 ms |
| **p95 sessione 8+ turni** | ~3200 ms | ~2900 ms | **−300 ms** (cache warm) |

### 5.2 Complessità manutentiva

| Dimensione | Legacy | Command Layer |
|---|---|---|
| Nuova capability conversazionale | 3-5 file da modificare | 1 comando nel registry |
| Nuovo flow | Solo fixture JSON | Solo fixture JSON + infoIntents[] |
| Debug turno fallito | 4 layer (extractor → policy → overwrite → executor) | 1 turn-log entry JSON + dispatch log |
| Audit compliance | State log senza intent dichiarato | Turn-log completo (commands, stateDiff, timestamps) |
| Test per nuovo flow | ~15 spec e2e reali (lenti) | Unit mock + 2-3 smoke live |

### 5.3 LoC delta

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

## 6. Tabella comparativa — robustezza e compliance bancaria

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

## 7. Migration path

Il fallback legacy è stato **rimosso il 2026-04-26**. Non c'è più migrazione da fare: tutti i flow INTERACTIVE_FLOW passano per il command layer di default. Le fixture esistenti devono essere conformi al contratto strutturale:

1. Nodi `USER_INPUT` e `CONFIRM` con `message` come oggetto localizzato `{ "it": "...", "en": "..." }` (o `{ "dynamic": true, "fallback": {...}, "systemPromptAddendum": "..." }`).
2. `"errorPolicy": { "onFailure": "SKIP" }` sui nodi TOOL che possono fallire in modo recuperabile.
3. `infoIntents: []` (o lista delle intent disponibili) — campo richiesto.
4. `mcpGatewayId` nel flow settings (già obbligatorio per TOOL nodes).

Per aggiungere un nuovo flow vedi [command-layer-developer-guide.md](command-layer-developer-guide.md).

### 7.1 Fallback rimosso (2026-04-26)

Il dual-path è stato eliminato in 5 fasi (vedi [progress-log.md](progress-log.md)):

- **Fase 1**: eliminati ~32 file di test legacy (13 e2e + 4 API unit + 11 engine unit + 1 R-RO.4 integration + cleanup blocchi del flag-toggle nel validator test).
- **Fase 2**: rimossi i ternari di branching nell'executor (resume + first-turn) e `selectAdapter` in `turn-interpreter-adapter.ts`. Migrata `estinzione.json` strutturalmente. Nuovo spec `command-layer-estinzione.local.spec.ts`.
- **Fase 3**: eliminati 4 moduli runtime legacy (`field-extractor`, `overwrite-policy`, `pending-interaction-resolver`, `meta-question-handler`), endpoint `/field-extract` (~600 LoC). Validator: `checkCommandLayerCompatibility` → `checkPostgresRequired` (universale).
- **Fase 4**: rimosso il campo flag-toggle dallo schema `InteractiveFlowActionSettings`. Bump `@activepieces/shared` 0.69.1 → 0.70.0. Ripulita `consultazione-cliente.json`.
- **Fase 5**: rinominata i18n key `validation.commandLayer.*` → `validation.interactiveFlow.*` in 12 locales. Eliminata `featureDisabled`. Archiviati 14 doc storici in `docs/interactive-flow/archive/`. Aggiornati CLAUDE.md/AGENTS.md.

Done condition: 0 residui del flag-toggle nel codice attivo (`packages/`, `fixtures/`, root markdown).

---

## 8. Risultati test finali (2026-04-26)

| Suite | Totale | Passati | Falliti | Skip |
|---|---|---|---|---|
| Engine (Vitest) | 351 | 351 | 0 | 0 |
| API integration (Vitest) | 354 | 354 | 0 | 0 |
| Playwright command-layer (incluso `estinzione`) | 14 | 14 | 0 | 0 |

---

## 9. Verdetto

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

## 10. Riferimenti

- [current-vs-proposed.md](current-vs-proposed.md) — analisi originale legacy vs Modo 3
- [solution-final-v3.3.md](solution-final-v3.3.md) — spec definitiva Server-governed Command Layer
- [command-layer-developer-guide.md](command-layer-developer-guide.md) — guida sviluppatore
- [command-layer-migration-guide.md](command-layer-migration-guide.md) — migrazione flow esistenti
- [progress-log.md](progress-log.md) — log implementazione task per task
