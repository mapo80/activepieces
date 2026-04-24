# INTERACTIVE_FLOW — soluzione attuale vs proposta (Tool-calling Agent)

> **⚠️ Superseded by [solution-final-v3.3.md](solution-final-v3.3.md)**. Questo documento rimane come riferimento storico della comparativa "as-is vs Modo 3/v2". La proposta architetturale definitiva è **Server-governed Conversation Command Layer** (v3.3), iterazione finale dopo tre giri di review code-aware Codex. v3.3 chiude il ciclo di revisione documentale: prossimo step obbligatorio è spike SQL/concurrency con test reali. Per il design di riferimento usare v3.3.

> Comparativa tecnica puntuale fra il pipeline conversazionale **oggi in produzione** sul fork Activepieces e la proposta **Modo 3 — Tool-calling Agent** (cfr. [solution-final-v2.md](solution-final-v2.md)). Obiettivo: rendere esplicito cosa cambia, file per file, capacità per capacità, costo per costo.

## 1. Contesto

La POC prevede **5-10 flow INTERACTIVE_FLOW distinti** nei prossimi 12 mesi. La soglia oltre cui un approccio a intent-enum o handler per-flow diventa costoso (duplicazione, drift, regressioni cross-flow) è ~2 flow. Il volume target supera nettamente la soglia → serve un'architettura che scali senza modifiche al core.

Questo documento confronta i due approcci su **4 assi**:

1. Struttura interna (file, componenti, flusso di un turno)
2. Capacità funzionali (10 requisiti presi da [flows-analysis.md](flows-analysis.md) §7.1)
3. Costo operativo (latenza, $, LoC, complessità manutentiva)
4. Rischio e migration path

---

## 2. Pipeline attuale (baseline)

### 2.1 Layer map

| Layer | File | Simbolo chiave | Ruolo |
|---|---|---|---|
| Action type | [packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts](../../packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts) | `FlowActionType.INTERACTIVE_FLOW` | Schema Zod di settings, nodes, stateFields, pending |
| Dispatch | [packages/server/engine/src/lib/handler/flow-executor.ts](../../packages/server/engine/src/lib/handler/flow-executor.ts) | `getExecuteFunction()` | Routa a `interactiveFlowExecutor` |
| Orchestrazione | [packages/server/engine/src/lib/handler/interactive-flow-executor.ts](../../packages/server/engine/src/lib/handler/interactive-flow-executor.ts) | `interactiveFlowExecutor.handle()` | Entry point turno, DAG loop, pending computation |
| Estrazione LLM | [packages/server/engine/src/lib/handler/field-extractor.ts](../../packages/server/engine/src/lib/handler/field-extractor.ts) | `extractWithPolicy()` | Chiamata a endpoint AI controller |
| Controller AI | [packages/server/api/src/app/ai/interactive-flow-ai.controller.ts](../../packages/server/api/src/app/ai/interactive-flow-ai.controller.ts) | `POST /v1/engine/interactive-flow-ai/field-extract` | `generateText()` + schema dinamico |
| Schema estrazione | idem | `buildExtractionSchemaFromFields()` | Zod dinamico da `stateFields[]` |
| Candidate policy | [packages/server/api/src/app/ai/candidate-policy.ts](../../packages/server/api/src/app/ai/candidate-policy.ts) | `verifyEvidence()`, `verifyFieldPlausibility()`, `verifyDomain()`, `verifyFieldAdmissibility()` | Gate deterministici su ogni candidato estratto |
| Overwrite / topic change | [packages/server/api/src/app/ai/overwrite-policy.ts](../../packages/server/api/src/app/ai/overwrite-policy.ts) | `detectCueOfCorrection()`, `decideOverwrite()` | Regex cue + decisione accept/reject/confirm |
| Applicazione stato | [packages/server/engine/src/lib/handler/session-store.ts](../../packages/server/engine/src/lib/handler/session-store.ts) | `applyStateOverwriteWithTopicChange()` | Reset downstream state |
| Pending resolver | [packages/server/api/src/app/ai/pending-interaction-resolver.ts](../../packages/server/api/src/app/ai/pending-interaction-resolver.ts) | `resolveFromPendingInteraction()` | Parse ordinali IT, keyword conferma/rifiuto |
| Meta intent | [packages/server/api/src/app/ai/meta-question-handler.ts](../../packages/server/api/src/app/ai/meta-question-handler.ts) | `detectMetaIntent()`, `renderMetaAnswer()` | Regex IT/EN per ask-repeat/clarify/progress/help/cancel — **output non usato dall'executor** |
| MCP gateway | interactive-flow-executor.ts | `resolveGateway()`, `executeToolWithPolicy()` | JSON-RPC 2.0 al gateway configurato |
| Runtime events | [packages/server/engine/src/lib/handler/interactive-flow-events.ts](../../packages/server/engine/src/lib/handler/interactive-flow-events.ts) | `interactiveFlowEvents.emit()` | Kind: `STARTED`, `COMPLETED`, `FAILED`, `SKIPPED`, `PAUSED`, `BRANCH_SELECTED` |

### 2.2 Flusso di un turno (as-is)

```
operatore ──► WebSocket ──► interactiveFlowExecutor.handle()
                               │
                               ▼
                    ┌──────────────────────────┐
                    │ resolvePendingInteraction│  (se pending attivo)
                    │ (ordinal, yes/no, ...)   │
                    └────────┬─────────────────┘
                             │ altrimenti
                             ▼
                    ┌──────────────────────────┐
                    │ fieldExtractor.extract   │──► POST /field-extract
                    │   WithPolicy             │       │
                    └────────┬─────────────────┘       ▼
                             │               generateText() + Zod schema
                             │               costruito da stateFields
                             │                      │
                             │                      ▼
                             │               {extractedFields, turnAffirmed,
                             │                policyDecisions, metaAnswer?,
                             │                clarifyReason?}
                             │◄─────────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ candidatePolicy gates    │
                    │ (evidence, admissibility,│
                    │  plausibility, domain)   │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ overwritePolicy:         │
                    │ detectCueOfCorrection +  │
                    │ decideOverwrite          │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ applyStateOverwriteWith  │
                    │ TopicChange (se needed)  │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ DAG loop:                │
                    │ findReadyToolNodes()     │──► executeToolWithPolicy (MCP)
                    │ findReadyBranchNodes()   │
                    │ findNextUserOrConfirm    │
                    │ while (changed) { ... }  │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ computePendingInteraction│
                    │ (confirm_binary,         │
                    │  pick_from_list, ...)    │
                    └────────┬─────────────────┘
                             ▼
                        PAUSED event → frontend
```

### 2.3 Cosa funziona oggi (punti di forza)

- **Extraction robusta**: il passaggio `candidatePolicy` con evidence/admissibility/plausibility/domain dà garanzie forti di non-hallucination. Tutti i valori che finiscono in state hanno un'evidenza nel messaggio utente.
- **Overwrite detection**: le regex cue coprono i principali pattern di correzione IT/EN. `applyStateOverwriteWithTopicChange` resetta lo state downstream correttamente.
- **Pending resolver**: il parsing ordinali italiani ("il primo", "l'ultimo") e keyword conferma è solido.
- **Separation of concerns**: il controller AI è stateless; l'executor è deterministico una volta estratti i campi. Test e2e coprono una fetta significativa.
- **MCP integration**: gateway con retry/timeout/backoff già pronto.

### 2.4 Cosa non funziona (lacune documentate)

| # | Lacuna | Evidenza |
|---|---|---|
| G1 | **`metaAnswer` viene generato ma ignorato**: il controller lo produce, l'executor non lo legge. L'operatore che chiede "cosa mi avevi chiesto?" riceve ri-chiesta del campo, non la risposta | interactive-flow-executor.ts non ispeziona `metaAnswer` del result |
| G2 | **Info-question assenti**: nessun path per "quanti rapporti ha il cliente?" → cade in extraction miss | Nessun handler, nessuna intent class |
| G3 | **Cancel flow assente**: `detectMetaIntent` riconosce `ask-cancel` ma `renderMetaAnswer` produce solo un testo. La sessione NON viene terminata | meta-question-handler.ts:ask-cancel = string template, nessun side-effect su session-store |
| G4 | **Compound intent impossibile**: lo schema estrazione è orientato a "quali campi estrarre?", non a "l'utente ha chiesto X AND mi ha dato Y" | Schema Zod dinamico è `{ [fieldName]: value }`, no azioni |
| G5 | **Runtime timeline povera**: eventi solo `STARTED/COMPLETED/FAILED/SKIPPED/PAUSED/BRANCH_SELECTED`. Nessun `FIELD_EXTRACTED`, `TOPIC_CHANGED`, `META_ANSWERED`, `OVERWRITE_PENDING` | Enum in websocket/index.ts |
| G6 | **Extraction schema domain-coupled**: ogni nuovo flow richiede di ripensare lo schema Zod e come si integra col resto. Non c'è un "contratto conversazionale" invariante | buildExtractionSchemaFromFields è parametrizzato, ma il contratto di output è fisso su "extracted + metaAnswer" |
| G7 | **Loop prevention assente**: se l'operatore chiede 3 volte "cosa?", il sistema chiede 3 volte il campo | Nessun contatore di meta-intent consecutivi |

### 2.5 Stima LoC attuale (baseline)

| Layer | LoC approssimative |
|---|---|
| interactive-flow-executor.ts | ~1400 |
| field-extractor.ts | ~200 |
| interactive-flow-ai.controller.ts | ~600 |
| candidate-policy.ts | ~400 |
| overwrite-policy.ts | ~250 |
| pending-interaction-resolver.ts | ~350 |
| meta-question-handler.ts | ~200 |
| session-store.ts (porzione IF) | ~300 |
| **Totale stima** | **~3700** |

---

## 3. Pipeline proposta (Modo 3 — Tool-calling Agent)

### 3.1 Idea architetturale

Un **unico LLM call per turno** che non produce "campi estratti" ma **una sequenza di tool-call** fra 7 tool predefiniti:

| Tool | Parametri | Semantica |
|---|---|---|
| `setStateField` | `{ field, value, evidence }` | Assegna un campo (sostituisce extraction corrente) |
| `askClarification` | `{ message, missingField? }` | Richiesta all'utente, sospende turno |
| `answerMeta` | `{ kind, message }` | Risposta a "cosa?"/"ripeti"/"non ho capito" |
| `answerInfo` | `{ message, citedFields[] }` | Risposta a info-question usando state |
| `requestCancel` | `{ reason? }` | Propone cancel, crea `pending_cancel` |
| `confirmCancel` | `{}` | Conferma cancel dopo `pending_cancel` |
| `noop` | `{ reason }` | Nessuna azione (ack, off-topic, saluto) |

Il numero di tool-call emessi in un turno è **variabile**: tipicamente 1 (`setStateField` singolo) ma può essere N (batched: `setStateField × 4`), o misto (`setStateField + answerInfo` = compound intent). L'executor applica in ordine e aggiorna lo state.

### 3.2 Flusso di un turno (to-be)

```
operatore ──► WebSocket ──► interactiveFlowExecutor.handle()
                               │
                               ▼
                    ┌──────────────────────────┐
                    │ pending resolver         │  (invariato)
                    └────────┬─────────────────┘
                             │ altrimenti
                             ▼
                    ┌──────────────────────────┐
                    │ conversationExecutor.run │──► POST /conversation-turn
                    │   (nuovo)                │       │
                    └────────┬─────────────────┘       ▼
                             │         Anthropic tool_use API
                             │         - 7 tools in registry
                             │         - bounded scope via prompt
                             │         - prompt caching on
                             │                      │
                             │               { tool_calls: [...] }
                             │◄─────────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ semantic constraints     │  (nuovo)
                    │ (max 1 per action type,  │
                    │  anti-false-positive     │
                    │  cancel filter)          │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ dispatch tool-call       │
                    │ - setStateField → state  │
                    │   (+ candidatePolicy)    │
                    │ - askClarification →     │
                    │   messageOut             │
                    │ - answerMeta/Info →      │
                    │   messageOut             │
                    │ - requestCancel →        │
                    │   pending_cancel         │
                    │ - confirmCancel → reset  │
                    │ - noop → ack             │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ DAG loop                 │  (invariato)
                    │ findReadyToolNodes()     │──► MCP (invariato)
                    │ findNextUserOrConfirm    │
                    └────────┬─────────────────┘
                             ▼
                    ┌──────────────────────────┐
                    │ runtime timeline emit    │  (esteso)
                    │ + 7 nuovi kind           │
                    └────────┬─────────────────┘
                             ▼
                        PAUSED event → frontend
```

### 3.3 Cosa non cambia

- **DAG execution**: invariato. `findReadyToolNodes`, `propagateSkip`, `executeToolWithPolicy` restano identici.
- **MCP integration**: invariata. Tool registry del Modo 3 è per la **conversazione**, non sostituisce i tool MCP dei nodi TOOL.
- **Pending resolver per confirm/pick**: invariato. `pick_from_list` e `confirm_binary` continuano come oggi. Si aggiunge solo `pending_cancel`.
- **Session-store base**: schema invariato, solo estensione per `pending_cancel`.
- **`candidatePolicy`**: viene **riusata** dentro il dispatch di `setStateField`. Le stesse regole (evidence, admissibility, plausibility, domain) si applicano prima di committare.
- **Overwrite policy**: viene **riusata**. Il cue detection resta; cambia solo che il tool-call `setStateField` viene valutato dalla stessa policy come farebbe un extraction-output.

### 3.4 Cosa cambia (punti di attenzione)

- **`extractWithPolicy` viene sostituito** da `conversationExecutor.run`. Il controller AI attuale (`/field-extract`) non sparisce: resta per retrocompatibilità dietro feature flag fino a completamento canary.
- **`metaAnswer` / `clarifyReason`** ritorno del controller attuale: **eliminati**. Diventano tool-call espliciti (`answerMeta`, `askClarification`).
- **Runtime events** estesi con 7 nuovi kind: `FIELD_EXTRACTED`, `META_ANSWERED`, `INFO_ANSWERED`, `TOPIC_CHANGED`, `OVERWRITE_PENDING`, `CANCEL_REQUESTED`, `CANCEL_CONFIRMED`. Frontend consuma come gli esistenti.
- **Schema estrazione dinamico** sparisce. Lo sostituisce il **tool registry statico** (7 tool). I campi del flow entrano nel prompt come descrizione, non come schema.

### 3.5 Stima LoC proposta

| Modulo nuovo | LoC |
|---|---|
| `conversation/tools/` (7 file + index + test) | ~600 |
| `conversation/executor.ts` | ~700 |
| `conversation/dispatcher.ts` (semantic constraints + dispatch) | ~500 |
| `conversation/prompt-builder.ts` | ~400 |
| `conversation/fallback.ts` (L1/L2/L3) | ~200 |
| Modifiche `interactive-flow-executor.ts` (feature flag + routing) | ~150 |
| Estensione runtime events + frontend | ~300 |
| Test suite statica 50 turni + runner mock | ~800 |
| Fixture `consultazione-cliente.json` | ~150 (JSON, non LoC propriamente) |
| **Totale nuovo codice** | **~3900** |

Codice **deprecabile** dopo canary completato (non rimosso in Phase 1):
- `field-extractor.ts` (200)
- `interactive-flow-ai.controller.ts#field-extract` endpoint (~400 delle 600 totali)
- `meta-question-handler.ts` intero (~200)
- Parti di `candidate-policy.ts` duplicate nel dispatcher (~100)

Quindi il **delta netto** a regime è ~3200 LoC (3900 aggiunte − 700 rimosse).

---

## 4. Confronto capability (10 requisiti funzionali)

| # | Requisito | Attuale | Proposto | Note |
|---|---|---|---|---|
| F1 | Estrazione con candidatePolicy | ✅ completo | ✅ riusato dentro `setStateField` | |
| F2 | Auto-select singolo match | ✅ completo | ✅ invariato (logica su pick_* node) | |
| F3 | Topic change + invalidazione downstream state | ⚠️ state sì, `executedNodeIds` parziale | ✅ completo (tool-call `setStateField` innesca `applyStateOverwriteWithTopicChange` + reset completo) | |
| F4 | Conferma esplicita al nodo CONFIRM, no auto-submit batched | ✅ completo | ✅ invariato (node-local scope del campo `confirmed`) | |
| F5 | Meta-question answered | ❌ metaAnswer ignorato | ✅ tool-call `answerMeta` dispatchato a messageOut | G1 risolto |
| F6 | Info-question answered | ❌ non esistente | ✅ tool-call `answerInfo` con citedFields | G2 risolto |
| F7 | Cancel flow con conferma | ❌ solo testo, nessun side-effect | ✅ `requestCancel` → `pending_cancel` → `confirmCancel` → reset sessione | G3 risolto |
| F8 | Compound intent | ❌ impossibile | ✅ nativo (N tool-call per turno) | G4 risolto |
| F9 | Runtime timeline completa | ⚠️ solo node events | ✅ +7 kind conversazionali | G5 risolto |
| F10 | Loop prevention meta consecutive | ❌ non esistente | ✅ contatore nel dispatcher, dopo 2× passa a `askClarification` forzato | G7 risolto |

**Punteggio**: attuale 4/10 completi, 2/10 parziali, 4/10 assenti. Proposto 10/10.

---

## 5. Confronto costo operativo

### 5.1 Latenza per turno

| Step | Attuale | Proposto | Delta |
|---|---|---|---|
| Preparazione prompt + schema | 10 ms | 15 ms | +5 ms (prompt più lungo) |
| LLM call | 1800 ms | 2200 ms | +400 ms (tool-use API ~20% più lenta di structured output puro, ma cache prompt compensa dal 2° turno) |
| Validazione output | 50 ms | 80 ms | +30 ms (dispatcher + semantic constraints) |
| Dispatch tool-call + DAG loop | 200 ms | 220 ms | +20 ms (trascurabile) |
| **Totale p50** | **~2060 ms** | **~2515 ms** | **+455 ms** |
| **p95** | ~3200 ms | ~3800 ms | sopra il target NF1 (≤3s) di ~25% nel peggior caso |

**Mitigazione**: prompt caching Anthropic (TTL 5min) riduce il 2°-N° turno a ~1800 ms (sotto baseline attuale grazie alla cache del system prompt). Media pesata su una sessione tipica (8-12 turni): p95 stimato ~2900 ms, sotto target.

### 5.2 Costo $ per turno

| Modello | Input token | Output token | Cost attuale | Cost proposto | Delta |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | ~1800 | ~200 | $0.0084 | $0.014 (1° turno) / $0.0063 (turni cached) | 1.5-2× peggio 1° turno, 0.75× meglio cached |
| Media sessione 10 turni | — | — | $0.084 | $0.071 | **~15% meglio** con cache hit rate 70%+ |

**Nota**: il costo per il singolo turno peggiora (tool-use API con schema strict costa più del tool-less structured output), ma la cache ripaga dal 2° turno. Su sessioni corte (1-3 turni) il proposto costa il 30-40% in più; su sessioni lunghe (>8 turni, caso tipico estinzione) costa meno.

### 5.3 Complessità manutentiva

| Dimensione | Attuale | Proposto |
|---|---|---|
| File chiave da editare per nuovo flow | 0 (solo fixture JSON) | 0 (solo fixture JSON) |
| File chiave da editare per nuova capability conversazionale | 3-5 (executor + controller + resolver) | 1 (nuovo tool nel registry) |
| Test da scrivere per nuovo flow | ~15 spec e2e | ~8 spec mock (runner deterministico) + 2-3 smoke reali |
| Debug di un turno fallito | Trace attraverso 4 layer (extractor, policy, overwrite, executor) | Trace di 1 tool-call log + dispatcher log |
| Audit trail per compliance | State log + evento PAUSED | Tool-call log strutturato (ogni turno = evento JSON completo) — migliore per audit bancario |

### 5.4 Robustezza

| Aspetto | Attuale | Proposto |
|---|---|---|
| Non-hallucination | ✅ candidatePolicy forte | ✅ candidatePolicy riusata + schema strict tool | 
| Fabrication (LLM inventa tool-call) | N/A | ⚠️ Failure mode di tool-calling — mitigato con evidence exact-match obbligatoria in `setStateField` |
| Recovery da errore LLM | Retry singolo | 3 livelli: L1 retry, L2 template provider-down, L3 targeted "non ho colto" |
| Schema drift fra flow | N/A (schema per-flow) | Registry invariante cross-flow — niente drift possibile |
| Regressione su flow esistenti | Alta (ogni modifica tocca tutti) | Bassa (tool registry stabile, flow parametrizzati) |

---

## 6. Compliance bancaria

Aspetto non banale: il proposto migliora o peggiora?

| Requisito compliance | Attuale | Proposto | Commento |
|---|---|---|---|
| Audit trail completo | Parziale (state log senza intent dichiarato) | Completo (ogni tool-call è un evento JSON con timestamp, args, exec result) | **Proposto migliore** |
| Non-dispositività accidentale | ✅ (conferma esplicita su nodo CONFIRM) | ✅ identico (scope node-local invariato) | Parità |
| Determinismo replay | ✅ (state log replayabile) | ✅ (tool-call log replayabile — più granulare) | **Proposto migliore** |
| Confinamento extraction a campi dichiarati | ✅ (schema per-flow) | ✅ (`field` arg di `setStateField` enforced contro `stateFields[]`) | Parità semantica, meccanismo diverso |
| Cancel tracciato | ❌ (nessun evento) | ✅ (`CANCEL_REQUESTED` + `CANCEL_CONFIRMED`) | **Proposto migliore** |
| Fallback testuale predicibile | ⚠️ (eccezioni risalgono) | ✅ (L1/L2/L3 con messaggi definiti) | **Proposto migliore** |

---

## 7. Migration path

### 7.1 Phasing (come da plan operativo)

1. **Phase 1 — Tool registry & schema** (~600 LoC, isolato, no runtime impact)
2. **Phase 2 — Executor + integrazione** (~1800 LoC, feature flag `USE_TOOL_CALLING_EXECUTOR` default off)
3. **Phase 3 — Safeguard & fallback** (~700 LoC, estensioni al dispatcher)
4. **Phase 4 — Test suite & canary** (~800 LoC + fixture consultazione; abilita Modo 3 solo su `consultazione-cliente` dietro feature flag per-flow)

### 7.2 Feature flag dual-path

Durante il canary (settimane 1-4 post Phase 4), entrambi i pipeline coesistono:

```typescript
if (flow.settings.useToolCallingExecutor === true) {
  return conversationExecutor.run(...)   // nuovo
} else {
  return fieldExtractor.extractWithPolicy(...)  // attuale
}
```

Canary su consultazione prima (read-only, zero rischio dispositivo). Solo dopo passaggio delle 8 metriche target, rollout graduale a estinzione.

### 7.3 Rollback

Istantaneo via feature flag. Il codice attuale **non viene rimosso** in Phase 1-4. Rimozione pianificata in una fase successiva (~Phase 6) solo dopo 30 giorni di stabilità in produzione su tutti i flow.

---

## 8. Rischi introdotti dalla proposta

| # | Rischio | Probabilità | Mitigazione |
|---|---|---|---|
| R1 | LLM fabrica `field` o `value` fuori dai `stateFields` | Media | Enforcement pre-dispatch: `field` deve essere ∈ `stateFields[].name`; `value` passa da `candidatePolicy` |
| R2 | Tool-use API regression upstream (Anthropic) | Bassa | Feature flag → rollback istantaneo |
| R3 | Latenza p95 oltre target su sessioni corte | Media | Cache prompt + compressione system prompt; accettare degrado su sessioni <3 turni (minoranza) |
| R4 | Cancel falso-positivo (LLM interpreta male "annulla") | Media | UI distintiva bottone rosso 🛑, anti-false-positive keyword filter, requires `pending_cancel` confirm step |
| R5 | Canary consultazione non sufficiente a scoprire bug estinzione | Media | Test suite statica 50 turni + 25 specifici per estinzione prima del rollout estinzione |
| R6 | Costo $ peggiore del previsto | Bassa | Cache hit rate misurato in canary; se <60% → stop rollout, ottimizza prompt |
| R7 | Migrazione fixture esistenti richiede modifiche | Bassa | Flow settings retrocompatibili; nessun cambio al fixture JSON di estinzione |
| R8 | Schema strict di Anthropic non supporta union complesse | Bassa | Tool registry progettato con schema flat (no discriminated union annidati) |

---

## 9. Verdetto

| Criterio | Vincitore |
|---|---|
| Capability funzionali (F1-F10) | **Proposto** (10/10 vs 4/10 completi) |
| Latenza p95 sessione tipica | **Proposto** (dopo cache warm-up) |
| Costo $ su sessione lunga | **Proposto** (-15% con cache ≥70%) |
| Costo $ su sessione corta | Attuale (+30-40% nel proposto) |
| Complessità manutentiva | **Proposto** (1 file vs 3-5 per capability) |
| Audit trail | **Proposto** |
| Rischio di regressione cross-flow | **Proposto** (registry invariante) |
| Tempo di sviluppo iniziale | Attuale (0 LoC vs ~3900 LoC) |
| Maturity / battle-tested in prod | Attuale (ha visto traffico reale) |

**Verdetto ponderato su 5-10 flow in POC**: Proposto vince 7 criteri su 9. Gli unici due dove l'Attuale vince (costo sessione corta, maturity) sono temporanei e accettabili nel contesto di una POC con canary rigoroso.

La scelta **Modo 3 — Tool-calling Agent** è giustificata, ma **solo** dietro il phasing proposto (4 step, feature flag dual-path, canary su consultazione read-only prima di estinzione). Senza quei safeguard, il rischio operativo supera il beneficio.

---

## 10. Rappresentazione visuale del flow

Requisito esplicito: **la rappresentazione visuale del flow deve restare come oggi**. Il sistema ha **3 viste distinte**, ciascuna con sorgenti dati e componenti proprie. Qui documento l'impatto della proposta su ognuna.

### 10.1 Vista A — Flow Canvas (builder editor)

Il canvas dove si disegna/visualizza il flow con nodi collegati (cards + edges).

| Proprietà | Valore |
|---|---|
| File | [packages/web/src/app/builder/flow-canvas/index.tsx](../../packages/web/src/app/builder/flow-canvas/index.tsx) |
| Libreria | `@xyflow/react` (ReactFlow v12) |
| Componente | `FlowCanvas` |
| Sorgente dati | `flowVersion` da `useBuilderStateContext` |
| Derivazione nodi | `flowCanvasUtils.createFlowGraph(flowVersion, notes)` → traverse ricorsivo via `flowStructureUtil.getStep()` |
| Tipo nodo custom | `ApInteractiveFlowChildNode` |

**Impatto proposta**: **ZERO**. Questa vista è alimentata da `flowVersion.trigger.nextAction.settings.nodes[]` — la struttura `nodes[]` del fixture JSON resta identica. Il Tool-calling Agent opera sul livello **conversazionale** (come viene interpretato il turno utente), non modifica la definizione del DAG che viene disegnato.

```
Fixture JSON (settings.nodes)      →     FlowCanvas renderizza nodi+edges
    [ attuale: identico ]                  [ attuale: identico ]
                                           
Fixture JSON (settings.nodes)      →     FlowCanvas renderizza nodi+edges
    [ proposto: identico ]                 [ proposto: identico ]
```

Nessun file sotto `packages/web/src/app/builder/` viene toccato in Phase 1-4.

### 10.2 Vista B — Runtime Node States (overlay sul canvas)

L'overlay che durante l'esecuzione colora i nodi del canvas (blu=running, verde=done, giallo=paused, grigio=skipped, rosso=failed).

| Proprietà | Valore |
|---|---|
| File | [packages/web/src/app/builder/flow-canvas/nodes/interactive-flow-child-node.tsx](../../packages/web/src/app/builder/flow-canvas/nodes/interactive-flow-child-node.tsx) |
| Componente | `ApInteractiveFlowChildCanvasNode` |
| Hook | `useInteractiveFlowNodeStates(run?.id)` |
| Reducer | [packages/web/src/features/interactive-flow/hooks/interactive-flow-runtime-reducer.ts](../../packages/web/src/features/interactive-flow/hooks/interactive-flow-runtime-reducer.ts) → `applyInteractiveFlowEvent()` |
| Sorgente dati | WebSocket `WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE` |
| Kind consumati | `STARTED`, `COMPLETED`, `FAILED`, `SKIPPED`, `PAUSED`, `BRANCH_SELECTED` |

**Impatto proposta**: **ZERO**. Questi eventi sono emessi dal **DAG loop** in `interactive-flow-executor.ts` (`findReadyToolNodes`, `executeToolWithPolicy`, `propagateSkip`, `findNextUserOrConfirmNode`), che resta **invariato**. Il Tool-calling Agent si inserisce **prima** del DAG loop (sostituisce l'extraction), non lo sostituisce.

```
┌──────────────────────┐
│ turno utente         │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ conversationExecutor │  ← nuovo (Tool-calling Agent)
│ (applica tool-call   │     emette: FIELD_EXTRACTED, META_ANSWERED, ...
│  conversazionali)    │     su evento WebSocket separato
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ DAG loop             │  ← invariato
│ (executeTool,        │     emette: STARTED, COMPLETED, ...
│  propagateSkip, ...) │     sullo stesso evento di oggi
└──────────────────────┘
```

I nodi del canvas continuano a ricevere esattamente gli stessi 6 kind di oggi, prodotti dallo stesso codice di oggi. La Vista B si comporta identica.

### 10.3 Vista C — Chain-of-thought timeline (nel chat)

La timeline che appare sotto ogni messaggio bot nel chat drawer, con icona per step (ricerca cliente, caricamento rapporti, ecc.) e label italiane.

| Proprietà | Valore |
|---|---|
| File timeline | [packages/web/src/features/interactive-flow/components/chat-runtime-timeline.tsx](../../packages/web/src/features/interactive-flow/components/chat-runtime-timeline.tsx) |
| File icon helper | [packages/web/src/features/interactive-flow/components/runtime-step-icon.tsx](../../packages/web/src/features/interactive-flow/components/runtime-step-icon.tsx) |
| Hook | [packages/web/src/features/interactive-flow/hooks/use-interactive-flow-current-turn.ts](../../packages/web/src/features/interactive-flow/hooks/use-interactive-flow-current-turn.ts) |
| Integrazione chat | [packages/web/src/features/chat/chat-message-list/index.tsx](../../packages/web/src/features/chat/chat-message-list/index.tsx) — `RuntimeSummaryDetails` in `<details>` collassabile |
| Conversione snapshot | [packages/web/src/app/routes/chat/flow-chat.tsx](../../packages/web/src/app/routes/chat/flow-chat.tsx) — `buildRuntimeSummaryFromSnapshot()` |
| Sorgente dati | Stesso WebSocket della Vista B (`INTERACTIVE_FLOW_NODE_STATE`) |
| Kind oggi | `STARTED`, `COMPLETED`, `FAILED`, `SKIPPED`, `PAUSED` |

**Impatto proposta**: **ESTENSIONE non-breaking**.

L'unica vista che si arricchisce. Oggi la timeline mostra solo **nodi del DAG** (es. "Cerca cliente… → Caricamento rapporti… → In attesa di conferma…"). Con Modo 3 aggiungiamo entry per **eventi conversazionali** che oggi sono invisibili all'operatore. Esempio:

```
┌──────────────────────────────────────────────────────┐
│ Operatore: "il cliente è Bellafronte e quanti        │
│            rapporti ha?"                             │
│                                                       │
│ Bot: Bellafronte Gianluca ha 3 rapporti attivi.      │
│      Quale rapporto vuoi estinguere?                 │
│                                                       │
│   ▼ Cronologia del turno                             │
│   ┌─ 📝 Estratto: cliente = "Bellafronte"   (nuovo) │
│   ├─ 🔍 Cerca cliente…                (oggi)        │
│   ├─ ✅ Cerca cliente (trovato 1 match)  (oggi)     │
│   ├─ 💾 Caricamento profilo…            (oggi)      │
│   ├─ 💾 Caricamento rapporti…           (oggi)      │
│   ├─ ℹ️ Risposta informativa: 3 rapporti  (nuovo)  │
│   └─ ⏸ In attesa scelta rapporto        (oggi)     │
└──────────────────────────────────────────────────────┘
```

**7 nuovi kind** aggiunti all'enum `InteractiveFlowNodeStateEvent.kind`:

| Kind | Quando | Rendering |
|---|---|---|
| `FIELD_EXTRACTED` | tool-call `setStateField` accettato dopo `candidatePolicy` | 📝 "Estratto: {field} = {value}" |
| `META_ANSWERED` | tool-call `answerMeta` dispatched | 💬 "Risposta conversazionale" |
| `INFO_ANSWERED` | tool-call `answerInfo` dispatched | ℹ️ "Risposta informativa" |
| `TOPIC_CHANGED` | `applyStateOverwriteWithTopicChange` innescato | 🔄 "Cambio argomento: {field}" |
| `OVERWRITE_PENDING` | `decideOverwrite` → action=confirm | ❓ "Conferma sovrascrittura richiesta" |
| `CANCEL_REQUESTED` | tool-call `requestCancel` → `pending_cancel` creato | ⚠️ "Annullamento proposto" |
| `CANCEL_CONFIRMED` | tool-call `confirmCancel` → sessione resettata | 🛑 "Flusso annullato" |

### 10.4 Modifiche frontend stimate

| File | Modifica | LoC |
|---|---|---|
| `packages/shared/src/lib/automation/websocket/index.ts` | Estendi enum `InteractiveFlowNodeStateEvent.kind` con 7 valori | ~20 |
| `interactive-flow-runtime-reducer.ts` | Gestisci i 7 nuovi kind in `applyInteractiveFlowEvent` | ~80 |
| `runtime-step-icon.tsx` | 7 icone nuove + mapping kind→icon | ~60 |
| `chat-runtime-timeline.tsx` | Nessuna modifica (è già stateless sui kind — li riceve via entries) | 0 |
| `use-interactive-flow-current-turn.ts` | Estendi tipo `InteractiveFlowStepEntry` se servono campi extra (es. `field`, `value` per FIELD_EXTRACTED) | ~30 |
| `chat-message-list/index.tsx` | Eventuale label i18n per i nuovi kind | ~20 |
| **Totale frontend** | | **~210 LoC** |

Incluse nelle ~300 LoC "Estensione runtime events + frontend" già contate in §3.5.

### 10.5 Riepilogo viste

| Vista | Oggi | Proposto | Delta |
|---|---|---|---|
| A — Flow Canvas builder | Render da `nodes[]` | Identico | **0 modifiche** |
| B — Runtime overlay canvas | 6 kind da DAG loop | Identico (DAG loop invariato) | **0 modifiche** |
| C — Chain-of-thought chat | 5 kind nodi + 6 stati | 5 kind nodi + **7 kind conversazionali** | **Estensione non-breaking** |

Il requisito "la rappresentazione visuale deve restare come oggi" è **soddisfatto al 100%** per A e B, e **arricchito in modo additivo** per C. Nessun elemento visuale oggi presente viene rimosso o ristrutturato.

---

## 11. Riferimenti

- [flows-analysis.md](flows-analysis.md) — analisi comparata dei 2 flow POC
- [proposals-comparison.md](proposals-comparison.md) — 25 scenari × 3 proposte (A/B/C)
- [solution-patterns.md](solution-patterns.md) — 5 "Modi" tecnici con tabella comparativa 18 criteri
- [solution-final-review.md](solution-final-review.md) — review critica v1 della proposta Modo 3
- [solution-final-v2.md](solution-final-v2.md) — iterazione v2 con 10 attack points auto-critici e raccomandazione definitiva
