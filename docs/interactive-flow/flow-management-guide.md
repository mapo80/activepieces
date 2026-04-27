# INTERACTIVE_FLOW — Guida completa alla gestione del Workflow + Chat informative

**Audience**: chi deve capire come funziona un turno conversazionale, come il command layer instrada un messaggio utente fra "avanzamento workflow" e "risposta informativa", e come si configurano nuovi flow.

**Pre-requisiti**: aver letto [architecture-command-layer-vs-previous.md](architecture-command-layer-vs-previous.md) per il contesto architetturale.

---

## 1. Sintesi: la separazione fra Workflow e Chat informative

Il command layer di INTERACTIVE_FLOW gestisce **due dimensioni indipendenti** in ogni turno:

1. **Workflow (WF)** — un DAG di nodi (`TOOL`, `USER_INPUT`, `CONFIRM`, `BRANCH`) che rappresenta i passaggi *obbligatori* per completare la pratica (es. estinzione: search → pick → load → confirm → submit).
2. **Chat informative** — interazioni conversazionali che **non avanzano lo stato** ma che il bot deve gestire: domande "che cliente avevo detto?", "quanti rapporti ha?", richieste di chiarimento, annullamento, off-topic.

In ogni turno l'utente può fare:
- Solo WF (es. "Bellafronte" → estrae customerName, avanza)
- Solo chat informativa (es. "ciao" → bot saluta, no avanzamento)
- **Compound** entrambi insieme (es. "Bellafronte quanti rapporti ha?" → estrae + risponde)

Le due dimensioni sono codificate da **ConversationCommand** distinti emessi dal LLM:

| Dimensione | Comando | Effetto sullo stato |
|---|---|---|
| **WF avanzamento** | `SET_FIELDS` | scrive su `state[fieldName]`, può triggerare topic change |
| **WF avanzamento** | `RESOLVE_PENDING` | risolve pending interaction (confirm_binary, pick_from_list, ecc.) |
| **WF richiesta** | `ASK_FIELD` | bot chiede esplicitamente un campo |
| **Chat informativa** | `ANSWER_META` | risponde a meta-question (4 kinds: ask-repeat/clarify/progress/help) — no advance |
| **Chat informativa** | `ANSWER_INFO` | risponde a info-question registrata (`infoIntents`) — no advance |
| **Chat informativa** | `REQUEST_CANCEL` | propone annullamento → crea pending_cancel |
| **Chat informativa** | `REPROMPT` | input non parsabile, chiede riformulazione (6 reasons) |

**Punto chiave**: il LLM può emettere **più ConversationCommand nello stesso turno** (compound). Il command-dispatcher li applica in sequenza deterministica: prima `SET_FIELDS`/`RESOLVE_PENDING` (state advancement), poi `ANSWER_*`/`REQUEST_CANCEL`/`REPROMPT` (chat).

---

## 2. Architettura runtime di un turno

### 2.1 Diagramma end-to-end

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (Chat UI)                                                       │
│    user types → POST /webhooks/:flowId/sync                              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AP API server (port 3000)                                               │
│    enqueue EXECUTE_FLOW job (BullMQ in-memory)                          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AP Worker → Engine sandbox (forked subprocess)                          │
│   1. session-store.load(sessionId) → state, history, sessionRevision    │
│   2. resolve userMessage (from resume body or trigger)                  │
│   3. commandLayerClientAdapter.interpret({                              │
│        message, state, history, stateFields, nodes, locale, …          │
│      })                                                                  │
│      └──HTTP──► POST /v1/engine/interactive-flow-ai/command-layer/      │
│                       interpret-turn                                     │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AP API: command-layer module                                            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 1. ACQUIRE LEASE                                                   │ │
│  │    turnLogService.acquireLease(turnId, sessionId, workerId)        │ │
│  │    → row interactive_flow_turn_log status='in-progress'           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │ 2. PROPOSE COMMANDS (LLM call via providerAdapter)                 │ │
│  │    VercelAIAdapter → claude-code-openai-bridge :8787 → Claude CLI  │ │
│  │    Tools registry dinamico da ConversationCommandSchema (7 tipi)   │ │
│  │    Risposta: ConversationCommand[] (es. [SET_FIELDS, ANSWER_INFO]) │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │ 3. POLICY VALIDATION                                                │ │
│  │    policy-engine valida ogni comando proposto:                      │ │
│  │     P0 schema  P3 evidence (no hallucination)                      │ │
│  │     P4 identity (no overwrite senza confirm)                        │ │
│  │     P5 allowed-fields (solo extractable da nodo corrente)          │ │
│  │    → acceptedCommands + rejectedCommands                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │ 4. DISPATCH                                                         │ │
│  │    command-dispatcher applica i comandi accettati:                  │ │
│  │     - SET_FIELDS → stateDiff + topicChange + clearedKeys           │ │
│  │     - RESOLVE_PENDING → pending → resolved/rejected                 │ │
│  │     - ANSWER_META/INFO → builds preDagAck via info-renderer         │ │
│  │     - REQUEST_CANCEL → pending_cancel                               │ │
│  │     - REPROMPT → preDagAck con reason                               │ │
│  │    → messageOut: { preDagAck, kind }                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │ 5. PREPARE                                                          │ │
│  │    turnLogService.prepare()                                         │ │
│  │    → row status='prepared' + outbox events INSERT (status='pending')│ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│                               ▼                                          │
│      InterpretTurnResponse (← engine consumes via HTTP)                 │
│         { stateDiff, messageOut, finalizeContract,                      │
│           acceptedCommands, lastPolicyDecisions,                        │
│           topicChange.clearedKeys, pendingInteractionNext, … }          │
└──────────────────────────────────────────────────────────────────────────┘
                               │ HTTP response
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Engine (continua)                                                       │
│   4. applyStateOverwriteWithTopicChange(extractedFields = stateDiff)    │
│      → state aggiornato + executedNodeIds reset per topic change        │
│   5. preDagAck = response.messageOut.preDagAck                          │
│   6. DAG loop:                                                           │
│      ├─ findReadyToolNodes() → executeToolWithPolicy(MCP) → AEP         │
│      ├─ findReadyBranchNodes() → branch evaluation                      │
│      ├─ propagateSkip() per errorPolicy SKIP                            │
│      └─ findNextUserOrConfirmNode() → pause                              │
│   7. statusRenderer.render({ state, locale, success })                   │
│      → post-DAG status text                                              │
│   8. botMessage = preDagAck + '\n\n' + statusText                        │
│   9. turnInterpreterClient.finalize(turnId, leaseToken)                  │
│      → row status='finalized' + outbox status→'publishable'             │
│  10. session-store.save(sessionId, state, history, sessionRevision)     │
│      → CAS check (412 su conflict)                                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AP API: outboxPublisher daemon (poll ogni 500ms)                        │
│    SELECT FROM interactive_flow_outbox WHERE eventStatus='publishable'   │
│    → websocketService.to(flowRunId).emit(INTERACTIVE_FLOW_TURN_EVENT)    │
│    → row eventStatus='published'                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ WS
                               ▼
                    Browser riceve turn-event
                    + bot bubble (message body sync HTTP)
```

### 2.2 Le 3 tappe della saga (acquire → prepare → finalize)

Il command layer è **transazionale**. Ogni turno passa attraverso una saga in 3 step, con stati persistiti su `interactive_flow_turn_log`:

| Step | Trigger | Stato turn-log | Cosa succede |
|---|---|---|---|
| **acquire** | inizio interpret-turn | `in-progress` | Lock idempotente su `turnId` (prima richiesta vince, retry → cached response) |
| **prepare** | dopo dispatch + outbox INSERT | `prepared` | Saga "in attesa di commit". Outbox events `status='pending'` |
| **finalize** | engine ha completato il DAG e salvato session | `finalized` | Outbox events → `publishable`. Stato pubblicato |
| **rollback** | engine fail su save (CAS 412 ecc.) | `compensated` | Outbox events → `void`, niente pubblicazione |
| **lock-recovery** | daemon: prepared > 5min | `compensated` (auto) | Saga zombie reclamata da `lockRecoveryDaemon` |

**Garanzie**:
- **At-most-once delivery**: se il client retry stesso `turnId`, ottiene la risposta cached (idempotency)
- **Crash-safe**: se l'API muore mid-prepared, `lockRecoveryDaemon` (poll 10s) compensa
- **Multi-tab safe**: due context inviano messaggi simultanei → CAS 412 → uno vince, l'altro retry

---

## 3. La separazione concettuale: WF vs Chat

### 3.1 Perché questa separazione esiste

Il **WF** (workflow) è la sequenza di nodi che porta a completare la pratica bancaria. Per estinzione: identificazione cliente → selezione rapporto → motivazione → data → PDF → conferma → submit. È il "cuore dispositivo" del flow.

La **chat informativa** è tutto ciò che l'utente fa **mentre** segue il WF: chiede chiarimenti, fa domande sui dati, vuole annullare, manda saluti, si distrae con off-topic. È il "lato umano" della conversazione.

Il legacy field-extractor mescolava i due: lo schema Zod estraeva campi e basta, qualunque altra utterance era trattata come "extraction miss" (rejection). Il command layer **separa esplicitamente**:

- Comandi che muovono il WF: `SET_FIELDS`, `RESOLVE_PENDING`, `ASK_FIELD`
- Comandi che gestiscono la chat: `ANSWER_META`, `ANSWER_INFO`, `REQUEST_CANCEL`, `REPROMPT`

Un singolo turno LLM emette **N comandi** (compound). Il dispatcher li applica in ordine: prima quelli che cambiano lo stato, poi quelli che generano testo.

### 3.2 Esempio concreto: turno compound

> User: **"Bellafronte quanti rapporti ha?"**

Il LLM emette **2 comandi** in un solo turno:

```json
{
  "acceptedCommands": [
    {
      "type": "SET_FIELDS",
      "updates": [
        { "field": "customerName", "value": "Bellafronte", "evidence": "Bellafronte" }
      ]
    },
    {
      "type": "ANSWER_INFO",
      "infoIntent": "count_accounts",
      "citedFields": ["accounts"]
    }
  ]
}
```

**Esecuzione (dispatcher)**:
1. SET_FIELDS applica `state.customerName = "Bellafronte"`. WF avanza.
2. ANSWER_INFO è registrato per dopo (richiede `accounts` nel state, ancora non popolato).

**Esecuzione (engine DAG)**:
1. `search_customer` parte (input customerName ora presente) → `customerMatches` popolato
2. `pick_ndg` con singleOptionStrategy=auto → `ndg` popolato
3. `load_profile` → `profile`, `load_accounts` → `accounts` popolati
4. `generate_report` → `reportBase64` popolato → pause su `confirm_shared`

**Bot message** (combina preDagAck + status):
- preDagAck del LLM (da ANSWER_INFO renderer): "Il cliente Bellafronte ha 17 rapporti attivi."
- statusRenderer post-DAG: "Vuoi confermare la condivisione del report?"

Output: *"Il cliente Bellafronte ha 17 rapporti attivi. Vuoi confermare la condivisione del report?"*

Un singolo turno utente ha simultaneamente: identificato il cliente (WF), risposto alla domanda info (chat), avanzato fino al pause finale (WF).

### 3.3 Esempio concreto: chat-only senza WF advance

> User: **"ciao"** (turno 1, state vuoto)

Il LLM emette **1 comando**:

```json
{
  "acceptedCommands": [
    {
      "type": "ANSWER_META",
      "kind": "ask-help",
      "message": "Buongiorno e benvenuto. Come posso aiutarti?"
    }
  ]
}
```

**Dispatcher**:
- ANSWER_META genera preDagAck (info-renderer) = *"Buongiorno e benvenuto nel servizio di consultazione clienti. Per poter procedere, avrei bisogno del cognome del cliente che desidera consultare."*
- `state` invariato.

**Engine DAG**:
- Nessun input nuovo → search_customer non parte → tutti i tools non eseguiti
- `findNextUserOrConfirmNode` → null (nessun nodo ready: pick_ndg richiede customerMatches non ancora prodotto)
- Branch "insufficient-info" attivato:
  - `customerName` extractable mancante → missingExtractable
  - `customerMatches` non-extractable producibile da search_customer (non ancora eseguito) → continue (no deadlock)
  - **prompt = preDagAck** del LLM (Fix 2 di [progress-log.md](progress-log.md)): *"Buongiorno e benvenuto..."*
- Persiste session con bot bubble = preDagAck + virtual pending `__insufficient_info__`.

Output: il bot mostra il messaggio LLM ricco. Il prossimo turno l'utente manderà "Bellafronte" e il flow ripartirà.

### 3.4 Esempio: cancel + recovery

> User: **"annulla"**

LLM:
```json
{
  "acceptedCommands": [
    { "type": "REQUEST_CANCEL", "reason": "user-requested" }
  ]
}
```

Dispatcher:
- Crea `pending_cancel` con `createdAt` corrente
- preDagAck = *"Sei sicuro di voler annullare l'operazione?"* (info-renderer kind=cancel-request)
- Risposta a turno: bot bubble + WS event `CANCEL_REQUESTED`

Turno successivo, utente: **"no continuiamo"**

LLM:
```json
{
  "acceptedCommands": [
    {
      "type": "RESOLVE_PENDING",
      "decision": "reject",
      "pendingType": "pending_cancel"
    }
  ]
}
```

Dispatcher:
- Risolve `pending_cancel` con `decision='reject'`
- Reset di `pendingInteraction` a null
- preDagAck = *"Procediamo con l'operazione."* (info-renderer kind=ack-only)
- WS event `CANCEL_REJECTED`

Il flow è ancora dove era prima del cancel (state preservato). Il prossimo turno utente continua normalmente.

---

## 4. Le 7+1 tipologie di ConversationCommand in dettaglio

### 4.1 SET_FIELDS — estrazione campo con evidence

```typescript
{
  type: 'SET_FIELDS',
  updates: [
    {
      field: 'customerName',         // deve essere ∈ stateFields[].name
      value: 'Bellafronte',           // qualsiasi tipo JSON
      evidence: 'Bellafronte',        // substring testuale del messaggio utente (P3 policy)
      confidence?: 0.95               // 0-1, opzionale
    }
  ]
}
```

**Politiche applicate**:
- **P3 evidence**: la `evidence` deve essere una sottostringa del `userMessage` (no hallucination)
- **P4 identity**: se il campo è già confermato (state pieno), non si può sovrascrivere senza `pending_overwrite` (RESOLVE_PENDING accept)
- **P5 allowed-fields**: il campo deve essere `extractable: true` nel `stateFields` del flow

**Side effects** (in command-dispatcher):
- Se più campi extractable già presenti cambiano simultaneamente → `topicChange = true`, `clearedKeys` = downstream stale (es. cambio customerName → reset customerMatches/ndg/profile/accounts)
- `executedNodeIds` reset per i nodi che producono `clearedKeys` → DAG ri-esegue

### 4.2 ASK_FIELD — il bot chiede un campo specifico

```typescript
{
  type: 'ASK_FIELD',
  field: 'closureDate',
  reason?: 'collect_date pending'
}
```

Tipicamente emesso quando:
- Il LLM rileva che un USER_INPUT pause è imminente e vuole anticipare la richiesta
- L'utente ha fornito tutto tranne un campo specifico

Genera `preDagAck` di tipo "ask-field" tramite info-renderer.

### 4.3 ANSWER_META — risposta a domanda meta-conversazionale

```typescript
{
  type: 'ANSWER_META',
  kind: 'ask-repeat' | 'ask-clarify' | 'ask-progress' | 'ask-help',
  message?: 'string opzionale di override'
}
```

**4 kinds**:
- `ask-repeat`: utente chiede *"cosa avevi chiesto?"* → bot ripete l'ultima domanda
- `ask-clarify`: utente chiede *"non ho capito"* → bot riformula
- `ask-progress`: utente chiede *"a che punto siamo?"* → bot riassume lo stato corrente
- `ask-help`: utente chiede aiuto generico → bot mostra opzioni disponibili

**No state advancement.** Il preDagAck è generato dall'info-renderer (server-side) sulla base dello state corrente + ultimo prompt.

### 4.4 ANSWER_INFO — risposta a info-question registrata

```typescript
{
  type: 'ANSWER_INFO',
  infoIntent: 'count_accounts',
  citedFields: ['accounts']
}
```

L'`infoIntent` deve essere registrato in `settings.infoIntents` del flow. Esempio in `consultazione-cliente.json`:

```json
"infoIntents": [
  {
    "id": "count_accounts",
    "description": "Quanti rapporti ha il cliente",
    "requiredFields": ["accounts"]
  },
  {
    "id": "count_matches",
    "description": "Quanti clienti corrispondono alla ricerca",
    "requiredFields": ["customerMatches"]
  }
]
```

L'info-renderer server-side ha una funzione registrata per ogni intent id (in `info-renderer.ts`) che riceve lo state e produce un testo deterministico (no LLM). Es.:

```typescript
function renderCountAccounts(state: InteractiveFlowState): RenderedInfoAnswer {
  const accounts = state.accounts as unknown[]
  if (!Array.isArray(accounts)) {
    return { text: 'Non ho ancora caricato i rapporti del cliente.', citedFields: [] }
  }
  return {
    text: `Il cliente ha ${accounts.length} rapporti attivi.`,
    citedFields: ['accounts'],
  }
}
```

**No state advancement.** preDagAck = `text` del renderer.

**Cited fields**: lista dei campi state usati per generare la risposta. Servono al frontend per highlighting + audit trail (turn-event `INFO_ANSWERED` mostra quali field sono stati citati).

### 4.5 REQUEST_CANCEL — proposta annullamento

```typescript
{
  type: 'REQUEST_CANCEL',
  reason?: 'user-requested'
}
```

Crea `pending_cancel` come pending interaction. Il prossimo turno utente deve risolverlo:
- "sì confermo" → RESOLVE_PENDING accept → terminate
- "no continuiamo" → RESOLVE_PENDING reject → resume

preDagAck = "Sei sicuro di voler annullare?" (info-renderer kind=cancel-request).

### 4.6 RESOLVE_PENDING — risolve pending interaction

```typescript
{
  type: 'RESOLVE_PENDING',
  decision: 'accept' | 'reject',
  pendingType: 'confirm_binary' | 'pick_from_list' | 'pending_overwrite' | 'pending_cancel' | 'open_text'
}
```

Il `pendingType` deve **matchare** il tipo del pending corrente nello state. 5 tipi di pending:

| pendingType | Quando viene creato | Risoluzione |
|---|---|---|
| `confirm_binary` | CONFIRM node (es. confirm_shared, confirm_closure) | accept = sharedConfirmed=true; reject = false → flow terminate senza submit |
| `pick_from_list` | USER_INPUT con DataTable + > 1 opzione | accept con `value` = chosen option; SET_FIELDS può equivalere |
| `pending_overwrite` | SET_FIELDS tenta sovrascrivere campo identity confermato | accept = applica nuovo valore + clearedKeys downstream; reject = preserve old |
| `pending_cancel` | REQUEST_CANCEL emesso | accept = terminate flow; reject = resume |
| `open_text` | USER_INPUT senza enum (text libero) | tipicamente non risolto via RESOLVE_PENDING ma via SET_FIELDS |

### 4.7 REPROMPT — input non parsabile

```typescript
{
  type: 'REPROMPT',
  reason: 'low-confidence' | 'policy-rejected' | 'off-topic' | 'ambiguous-input' | 'provider-error' | 'catalog-not-ready'
}
```

Il LLM segnala che l'input non è interpretabile. Il preDagAck è generato dall'info-renderer (kind=reprompt) e contiene un messaggio appropriato al `reason`. **No state advancement.**

I 6 reasons:
- `low-confidence`: il LLM non è sicuro di cosa l'utente intenda (es. "boh forse...")
- `policy-rejected`: la P3/P4/P5 ha rifiutato un comando (es. evidence non trovata)
- `off-topic`: utente fa domande estranee (es. "che tempo fa a Roma?")
- `ambiguous-input`: input multipli incompatibili
- `provider-error`: errore upstream del LLM (timeout, ecc.)
- `catalog-not-ready`: tool MCP fallito mid-turno (es. list_closure_reasons → 500)

### 4.8 Compound (multi-comando)

Tutti i comandi sopra possono essere emessi simultaneamente nello stesso turno. Esempi reali:

| Utterance | Commands emessi | Effetto |
|---|---|---|
| "Bellafronte quanti rapporti ha?" | SET_FIELDS + ANSWER_INFO | extract + answer |
| "scusa il cliente è Rossi" | SET_FIELDS (con topic change) | re-extract + reset state downstream |
| "il primo rapporto è 01-034-... motivazione 01 data 2026-12-31" | SET_FIELDS multipli | 3 campi atomici |
| "non so, forse Bellafronte" | SET_FIELDS + REPROMPT | extract con confidence bassa + reprompt |

---

## 5. Pending Interactions in dettaglio

Una **pending interaction** è uno stato del flow in cui il command layer attende una risposta specifica dall'utente. È persistita in `state.pendingInteraction` e visualizzata dal frontend.

### 5.1 confirm_binary

Schema:
```typescript
{
  type: 'confirm_binary',
  field: 'sharedConfirmed',   // campo target
  target: true | false,        // valore atteso
  nodeId: 'confirm_shared'     // nodeId che ha generato il pending
}
```

Trigger: il flow raggiunge un nodo `CONFIRM` (es. `confirm_shared`, `confirm_closure`). Il frontend mostra una `ConfirmCard` con bottoni "Confermo" / "Annulla".

Risoluzione tramite RESOLVE_PENDING:
- accept → state[field] = target → flow continua (es. submit)
- reject → state[field] = !target → flow terminate senza submit

### 5.2 pick_from_list

Schema:
```typescript
{
  type: 'pick_from_list',
  field: 'ndg',
  options: [
    { ordinal: 1, label: 'Bellafronte (NDG 11255521)', value: '11255521' },
    { ordinal: 2, label: 'Bellafronte (NDG 11999999)', value: '11999999' }
  ],
  nodeId: 'pick_ndg'
}
```

Trigger: USER_INPUT node con `render: { component: 'DataTable' }` e source array con > 1 elemento. Il frontend mostra una tabella selezionabile.

Risoluzione:
- SET_FIELDS sul `field` (con evidence dall'option chosen) — più comune
- RESOLVE_PENDING con `value` esplicito

**`singleOptionStrategy: 'auto'`**: se l'array ha esattamente 1 elemento, il pending non viene creato e il valore viene auto-selezionato (es. Bellafronte → 1 NDG → auto-pick).

### 5.3 pending_overwrite

Schema:
```typescript
{
  type: 'pending_overwrite',
  field: 'customerName',
  oldValue: 'Bellafronte',
  newValue: 'Rossi',
  nodeId: '__overwrite__'
}
```

Trigger: il LLM emette SET_FIELDS che cambierebbe un campo identity confermato (P4 policy). Per preservare la coerenza, il command layer non sovrascrive subito ma chiede conferma.

Risoluzione:
- accept → applica newValue + clearedKeys downstream (reset)
- reject → preserve oldValue, niente cambia

### 5.4 pending_cancel

Schema:
```typescript
{
  type: 'pending_cancel',
  reason?: 'user-requested',
  createdAt: '2026-04-27T10:30:00Z'
}
```

Trigger: REQUEST_CANCEL.

Risoluzione:
- accept → flow terminate, sessione cleared
- reject → flow resume, pending cleared

**TTL**: il pending_cancel ha un TTL di 60s. Se l'utente non risponde entro il TTL, il pending expire automaticamente e il flow continua come se non fosse stato emesso.

### 5.5 open_text

Schema:
```typescript
{
  type: 'open_text',
  field: 'closureReasonText',
  nodeId: 'collect_reason' | '__insufficient_info__'
}
```

Trigger: USER_INPUT node senza enum (text libero) o branch `__insufficient_info__` quando il flow non può avanzare e serve un campo extractable. Il frontend mostra un input testuale standard.

Risoluzione: SET_FIELDS sul field. Tipicamente il LLM nel prossimo turno estrae il valore.

---

## 6. TopicChange e clearedKeys

Quando l'utente cambia il "soggetto" della conversazione (es. "scusa il cliente è Rossi"), il command layer rileva un **topic change** e invalida lo stato downstream.

### 6.1 Algoritmo (in command-dispatcher)

1. SET_FIELDS riceve un update su un campo `extractable` già presente nello state.
2. `detectTopicChange`: se il nuovo valore è semanticamente diverso (non re-formulazione) → topic change.
3. `clearedKeys`: tutti i campi state downstream del field changed (calcolati via `buildDependencyGraph`).
4. `executedNodeIds` reset per i nodi che producono `clearedKeys` → DAG ri-esegue.

### 6.2 Esempio

State prima del turno (consultazione, mid-flow):
```json
{
  "customerName": "Bellafronte",
  "customerMatches": [...],
  "ndg": "11255521",
  "profile": {...},
  "accounts": [...]
}
```

User: **"scusa il cliente è Rossi"** → SET_FIELDS(customerName='Rossi')

Dispatcher detect topic change:
- `customerName` cambia → topicChanged = true
- Downstream di customerName: `customerMatches, ndg, profile, accounts, reportBase64, sharedConfirmed`
- clearedKeys = tutti questi (i presenti nello state)

State dopo:
```json
{
  "customerName": "Rossi"
  // tutto il resto cancellato
}
```

Engine reset `executedNodeIds` per `search_customer, pick_ndg, load_profile, load_accounts, generate_report, confirm_shared`. Al prossimo DAG loop, search_customer ri-esegue con "Rossi" (e fallisce → errorPolicy SKIP → bot graceful).

### 6.3 Differenza con pending_overwrite

| Situazione | Comportamento |
|---|---|
| Topic change "spontaneo" (utente formula correzione esplicita) | Cleared keys immediato + state reset |
| Sovrascrittura ambigua di campo identity confermato | `pending_overwrite` creato, attesa conferma utente |

Il LLM (con system prompt + history) decide quale dei due emettere. Generalmente:
- "scusa **il cliente è** Rossi" → topic change (linguaggio di correzione esplicito)
- "Rossi" sec. utterance dopo Bellafronte già confermato → pending_overwrite

---

## 7. ErrorPolicy: gestione errori sui TOOL nodes

Ogni TOOL node può dichiarare una `errorPolicy`:

```json
{
  "id": "search_customer",
  "nodeType": "TOOL",
  "tool": "banking-customers/search_customer",
  "errorPolicy": {
    "onFailure": "SKIP" | "FAIL" | "CONTINUE",
    "maxRetries": 0-5,
    "timeoutMs": 1000-600000
  }
}
```

### 7.1 SKIP

Il tool fallisce → il nodo viene marcato come `skipped` → `propagateSkip` cascade ai nodi downstream che dipendono dai suoi `stateOutputs`.

**Esempio**: estinzione, user manda "Mario Verdi" (non esiste in AEP). search_customer fail → SKIP → pick_ndg dipende da customerMatches → SKIP → load_profile dipende da ndg → SKIP → ... → flow termina.

Bot deve emettere un messaggio graceful (preDagAck del LLM "Mario Verdi non trovato"). L'utente al prossimo turno può correggere.

### 7.2 FAIL (default se non dichiarato)

Il tool fallisce → tutto il flow run fail con `INTERNAL_ERROR`. Il bot non risponde, frontend mostra "No response from chatbot". **Da evitare** in produzione su tool fragili.

### 7.3 CONTINUE

Il tool fallisce → il nodo è marcato `succeeded` ma con `output={}`. Il flow continua come se il tool avesse risposto vuoto. Utile per tool opzionali (es. analytics).

---

## 8. Configurare un nuovo flow INTERACTIVE_FLOW

### 8.1 Struttura del fixture JSON

```json
{
  "name": "Mio Flow",
  "type": "FLOW",
  "flows": [{
    "displayName": "Mio Flow",
    "schemaVersion": "20",
    "trigger": {
      "name": "trigger",
      "type": "PIECE_TRIGGER",
      "settings": {
        "pieceName": "@activepieces/piece-forms",
        "triggerName": "chat_submission",
        "input": { "botName": "Assistente" }
      },
      "nextAction": {
        "name": "interactive_flow",
        "type": "INTERACTIVE_FLOW",
        "settings": {
          "mcpGatewayId": "__AUTO_MCP_GATEWAY__",
          "messageInput": "{{trigger.message}}",
          "sessionIdInput": "{{trigger.sessionId}}",
          "cleanupOnSuccess": true,
          "historyMaxTurns": 20,
          "locale": "it",
          "flowLabel": { "it": "...", "en": "..." },
          "systemPrompt": "...",
          "infoIntents": [
            { "id": "...", "description": "...", "requiredFields": [...] }
          ],
          "stateFields": [
            { "name": "...", "type": "string", "extractable": true, ... }
          ],
          "nodes": [
            { "id": "...", "nodeType": "TOOL"|"USER_INPUT"|"CONFIRM"|"BRANCH", ... }
          ]
        }
      }
    }
  }]
}
```

### 8.2 Campi chiave di settings

| Campo | Descrizione |
|---|---|
| `mcpGatewayId` | ID del gateway MCP (sostituito da `__AUTO_MCP_GATEWAY__` placeholder durante import test) |
| `messageInput` | Template che estrae il message dal trigger (es. `{{trigger.message}}`) |
| `sessionIdInput` | Template per il sessionId (chat ID, di solito `{{trigger.sessionId}}`) |
| `cleanupOnSuccess` | Se true, cancella la session record al success terminale |
| `historyMaxTurns` | Quanti turni passati passare al LLM (default 20, max 100) |
| `locale` | Lingua del flow (it/en/...) |
| `flowLabel` | Localized string mostrato nel preDagAck (es. "estinzione del rapporto") |
| `systemPrompt` | Prompt dominio-specifico passato al LLM in ogni turno |
| `infoIntents` | Lista di info-question registrate (vedi §4.4) |
| `stateFields` | Schema dello state (campi tipizzati con `extractable`, `parser`, `enumFrom`, ecc.) |
| `nodes` | DAG dei nodi del flow |

### 8.3 stateFields — schema dello state

```json
{
  "name": "customerName",
  "type": "string",
  "extractable": true,
  "minLength": 2,
  "maxLength": 80,
  "pattern": "^[A-Za-zÀ-ÿ'\\- ]+$",
  "description": "Cognome o nome+cognome di un cliente esplicitamente menzionato.",
  "extractionScope": "global" | "node-local"
}
```

| Campo | Significato |
|---|---|
| `extractable` | Se true, il LLM può emettere SET_FIELDS su questo campo. Se false, è "internal" (output di tool) |
| `extractionScope` | `global` = estraibile in qualunque turno; `node-local` = solo quando il flow è al nodo specifico |
| `parser` | Nome di un parser server-side per validare/normalizzare (es. `ndg`, `absolute-date`) |
| `enumFrom` | Nome di un altro stateField (array) da cui i valori validi sono presi |
| `enumValueField` | Quale chiave dell'array element rappresenta il valore (es. `ndg` in customerMatches) |
| `pattern` | Regex per validazione |
| `sensitive` | Se true, il campo è redatto nel turn-log (es. `reportBase64`) |
| `label` | Localized string per il display (es. "NDG" / "Customer ID") |

### 8.4 Tipi di nodo

#### TOOL
```json
{
  "id": "search_customer",
  "name": "search_customer",
  "displayName": "Cerca cliente",
  "nodeType": "TOOL",
  "stateInputs": ["customerName"],
  "stateOutputs": ["customerMatches"],
  "tool": "banking-customers/search_customer",
  "toolParams": {
    "name": { "kind": "state", "field": "customerName" }
  },
  "outputMap": { "customerMatches": "results" },
  "errorPolicy": { "onFailure": "SKIP" }
}
```

- `tool`: stringa `<piece>/<action>` mappata via MCP gateway
- `toolParams`: argomenti del tool (kind: `state` (riferimento a state), `compose` (multi-field), `literal`)
- `outputMap`: mappa response keys a state field names

#### USER_INPUT
```json
{
  "id": "pick_ndg",
  "nodeType": "USER_INPUT",
  "stateInputs": ["customerMatches"],
  "stateOutputs": ["ndg"],
  "render": {
    "component": "DataTable",
    "props": {
      "sourceField": "customerMatches",
      "valueKey": "ndg",
      "columns": [
        { "key": "ndg", "header": "NDG" },
        { "key": "denominazione", "header": "Denominazione" }
      ]
    }
  },
  "singleOptionStrategy": "auto",
  "message": {
    "it": "Seleziona il cliente dalla lista",
    "en": "Select customer from list"
  }
}
```

- `render.component`: `DataTable`, `DatePickerCard`, `TextInput`, `ConfirmCard`
- `singleOptionStrategy`: `auto` (1 opzione → auto-pick), `confirm` (1 opzione → confirm prompt), `list` (sempre mostra)
- `message`: localized string o `{ dynamic: true, fallback, systemPromptAddendum }` (genera testo via questionGenerator)

#### CONFIRM
```json
{
  "id": "confirm_shared",
  "nodeType": "CONFIRM",
  "stateInputs": ["reportBase64", "profile"],
  "stateOutputs": ["sharedConfirmed"],
  "render": {
    "component": "ConfirmCard",
    "props": { "sourceField": "reportBase64" }
  },
  "message": {
    "it": "Confermi la condivisione del report?",
    "en": "Confirm sharing the report?"
  }
}
```

Genera `confirm_binary` pending. Il `stateOutput` (es. sharedConfirmed) è il flag boolean impostato da RESOLVE_PENDING.

#### BRANCH
```json
{
  "id": "route_by_type",
  "nodeType": "BRANCH",
  "stateInputs": ["customerType"],
  "branches": [
    {
      "id": "individual",
      "branchType": "CONDITION",
      "conditions": [[
        { "operator": "TEXT_EXACTLY_MATCHES", "firstValue": "{{customerType}}", "secondValue": "individual" }
      ]],
      "targetNodeIds": ["load_individual_profile"]
    },
    {
      "id": "fallback",
      "branchType": "FALLBACK",
      "targetNodeIds": ["load_corporate_profile"]
    }
  ]
}
```

Routing condizionale. Il primo `CONDITION` che matcha viene scelto, altrimenti `FALLBACK`. Operatori supportati: TEXT_EXACTLY_MATCHES, TEXT_CONTAINS, NUMBER_IS_EQUAL_TO, NUMBER_IS_GREATER_THAN, BOOLEAN_IS_TRUE, EXISTS, ecc.

### 8.5 infoIntents — registrazione intent informative

```json
"infoIntents": [
  {
    "id": "count_accounts",
    "description": "Numero di rapporti del cliente",
    "requiredFields": ["accounts"]
  }
]
```

Per ogni intent dichiarato, deve esistere un renderer registrato server-side in `info-renderer.ts`:

```typescript
const infoRenderers: Record<string, (state: InteractiveFlowState) => RenderedInfoAnswer> = {
  count_accounts: (state) => ({
    text: `Il cliente ha ${(state.accounts as unknown[])?.length ?? 0} rapporti.`,
    citedFields: ['accounts'],
  }),
  // ... altri renderer
}
```

L'`id` è invariante: il LLM emette `ANSWER_INFO(infoIntent='count_accounts')`, il dispatcher chiama `infoRenderers['count_accounts'](state)`.

---

## 9. Pattern e best practices

### 9.1 Quando usare un nodo USER_INPUT vs `__insufficient_info__` virtual

- **USER_INPUT esplicito**: quando il flow ha un punto di pause necessario (es. l'utente DEVE scegliere un rapporto).
- **`__insufficient_info__` virtual**: quando il flow potrebbe avanzare ma manca un campo extractable. Il command layer crea automaticamente un pending `open_text` virtuale e chiede il campo via preDagAck.

Generalmente, **non aggiungere** USER_INPUT solo per "chiedere il customerName all'inizio" — il fallback insufficient-info lo gestisce naturalmente (Fix 2 del 2026-04-27).

### 9.2 Quando usare errorPolicy SKIP vs FAIL

- **SKIP**: tool che dipendono da dati utente che possono non esistere (es. search_customer su nome inesistente). Il flow degrada graziosamente.
- **FAIL** (default): tool critici per la pratica dispositiva (es. submit_closure). Se fallisce, deve essere visibile come errore.
- **CONTINUE**: tool opzionali (es. analytics, logging non critici).

### 9.3 Quando un campo è `extractable: true` vs `false`

- **true**: l'utente può fornirlo via testo (customerName, ndg, motivazione, data).
- **false**: è output di un tool (customerMatches, profile, accounts, reportBase64) e non viene mai estratto da utterance.

Se vuoi che un field sia readable from state ma NON estraibile (es. il LLM non deve provare a "indovinarlo"), usa `extractable: false`.

### 9.4 Quando usare `extractionScope: 'node-local'`

Per campi che hanno significato solo in un nodo specifico (es. `confirmed` boolean del confirm node). Se `extractionScope: 'global'`, l'utente potrebbe dire "sì confermo" anche prima del nodo CONFIRM e il flow accidentalmente avanzerebbe.

### 9.5 Performance: numero di stateFields e nodi

- **stateFields**: max 30-40 campi raccomandato. Oltre, il prompt LLM diventa pesante e l'extraction degrada.
- **nodi DAG**: max 15-20 nodi raccomandato. Oltre, il flow diventa difficile da seguire e debuggare.
- **historyMaxTurns**: 20 (default) è OK per conversazioni medie. Su sessioni lunghe (>30 turni), considera 30-50.

### 9.6 systemPrompt — cosa scriverci

Il `settings.systemPrompt` è il dominio-specifico passato al LLM in ogni turno. Linee guida:

- **Definisci il ruolo**: "Sei un assistente bancario specializzato in estinzione rapporti."
- **Vincolo lingua**: "Rispondi sempre in italiano formale."
- **Vincoli di dominio**: "Non fornire consigli legali o fiscali."
- **Vincoli di estrazione**: "Estrai SOLO valori esplicitamente menzionati dall'utente. Niente hallucination."
- **Comportamento per ambiguità**: "Se l'utente è ambiguo, chiedi chiarimenti via REPROMPT."
- **Tono**: "Formale, professionale, non eccessivamente cortese."

**NON serve** elencare i ConversationCommand types — sono auto-derivati dal Zod schema.

---

## 10. Debugging e troubleshooting

### 10.1 Il flow non risponde (loading perenne)

Possibili cause:
1. Bridge LLM down → `curl http://localhost:8787/health`
2. AEP backend down → `curl http://localhost:8000/mcp/health`
3. Worker crashato → `ps -ef | grep "tsx.*worker.*bootstrap"`
4. Saga zombie → `SELECT status FROM interactive_flow_turn_log WHERE status='prepared' AND createdAt < NOW() - INTERVAL '5 minutes'` → lockRecoveryDaemon dovrebbe compensare

### 10.2 Il bot risponde con messaggio template generico

Sintomo: bot dice "Per procedere con la consultazione, indicami **customerName**" invece di un messaggio LLM ricco.

Causa: il command layer ha emesso `commands: []` (LLM timeout o MockProviderAdapter senza commands registrati). Il fallback statico è stato attivato.

Fix: verificare `AP_LLM_VIA_BRIDGE=true` env, bridge up, model registrato nel provider adapter.

### 10.3 InteractiveFlowDeadlock

Sintomo: log `InteractiveFlowDeadlock: Circular dependency detected` + `INTERNAL_ERROR`.

Causa storica: il check distingueva male tra "insufficient info" e "real deadlock" quando un campo non-extractable era prodotto da un nodo unresolved (es. customerMatches da search_customer).

Fix (commit `df50a500c3`): aggiunto `isProducedByUnresolved` check transitivo.

Se il deadlock continua: significa che c'è un **vero** ciclo nel DAG. Verificare il dependency graph del flow.

### 10.4 Topic change non resetta lo state downstream

Sintomo: utente cambia customer ma flow continua con i vecchi accounts.

Possibili cause:
1. `dependencyGraph` non costruito correttamente (verifica `nodes[].stateInputs/stateOutputs`)
2. Il LLM non ha emesso SET_FIELDS con topic change (è solo riformulazione)
3. `clearedKeys` non applicato dall'engine (verifica log `handle:session:topic-change`)

### 10.5 ANSWER_INFO non trova l'intent

Sintomo: log `[command-dispatcher] info intent not found: count_accounts`.

Cause:
1. L'intent non è registrato in `settings.infoIntents` del flow
2. Il renderer non è registrato in `info-renderer.ts`

Fix: verifica che l'`id` matchi esattamente in entrambi i punti.

---

## 11. Esempi end-to-end (turn-by-turn)

Per gli esempi reali eseguiti dai test e2e (M1, M2, M3, M5), vedi [architecture-command-layer-vs-previous.md §3.3](architecture-command-layer-vs-previous.md).

I 7 spec e2e che esercitano tutti i pattern sopra:
- `command-layer-bridge-smoke.local.spec.ts` (S1) — 1 turno gate
- `journey-consultazione-conversational.local.spec.ts` (M1) — 9 turni: SET_FIELDS, ANSWER_INFO×2, ANSWER_META×3, TopicChange, REPROMPT, confirm
- `journey-consultazione-confirm-reject.local.spec.ts` (M1bis) — 3 turni: confirm reject
- `journey-cancel-and-recovery.local.spec.ts` (M3) — 6 turni: cancel ×2, accept+reject+resume
- `journey-estinzione-saga-completa.local.spec.ts` (M2) — 5 turni: saga full path con caseId
- `journey-estinzione-single-prompt-correction.local.spec.ts` (M5) — 3 turni: 5 campi atomici + correction
- `journey-infra-resilience.local.spec.ts` (M4) — 4 sub-test: catalog-fail, CAS, slow MCP, happy

---

## 12. Riferimenti

- [architecture-command-layer-vs-previous.md](architecture-command-layer-vs-previous.md) — confronto storico legacy vs command layer + grafico ASCII completo
- [command-layer-developer-guide.md](command-layer-developer-guide.md) — guida sviluppatore con focus su API endpoints
- [progress-log.md](progress-log.md) — cronologia delle modifiche
- [archive/solution-final-v3.3.md](archive/solution-final-v3.3.md) — spec architetturale dettagliata (storica)

### File runtime principali

- `packages/server/api/src/app/ai/command-layer/turn-interpreter.ts` — orchestratore turno (acquire→propose→policy→prepare)
- `packages/server/api/src/app/ai/command-layer/command-dispatcher.ts` — applica `ConversationCommand[]` allo state + side-effects
- `packages/server/api/src/app/ai/command-layer/policy-engine.ts` — validazione P0..P5
- `packages/server/api/src/app/ai/command-layer/info-renderer.ts` — registry dei renderer per ANSWER_INFO/META
- `packages/server/api/src/app/ai/command-layer/vercel-ai-adapter.ts` — chiamata LLM via bridge
- `packages/server/api/src/app/ai/command-layer/outbox-publisher.ts` — daemon WS publish
- `packages/server/api/src/app/ai/command-layer/lock-recovery.ts` — daemon zombie cleanup
- `packages/server/engine/src/lib/handler/interactive-flow-executor.ts` — engine entry point per ogni turno
- `packages/server/engine/src/lib/handler/turn-interpreter-adapter.ts` — HTTP client engine→API
- `packages/server/engine/src/lib/handler/status-renderer.ts` — compose bot message bifase (preDagAck + status)
- `packages/server/engine/src/lib/handler/session-store.ts` — CAS + topic change propagation
- `packages/shared/src/lib/automation/interactive-flow/conversation-command.ts` — Zod schema dei 7 comandi
- `packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts` — Zod schema di settings + nodi
