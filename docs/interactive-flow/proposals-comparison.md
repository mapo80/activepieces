# Proposte conversazionali — comparazione sui flow reali

> Complemento a [flows-analysis.md](./flows-analysis.md). Questo documento prende ogni scenario conversazionale che emerge dai 2 flow (**estinzione**, **consultazione cliente**) e mostra **come viene gestito** da ciascuna delle 3 proposte architetturali. L'obiettivo è decidere in modo informato con esempi d'uso reali.

## 1. Riepilogo delle 3 proposte

| # | Proposta | Principio | Tool / Artefatto chiave |
|---|---|---|---|
| **A** | Conversation Intent System | L'LLM classifica il turno in un `UserIntent` discriminated union (7 variant). Un dispatcher delega a handler puri. | `UserIntent` enum + handler per variant |
| **B** | Tool-calling Agent | L'LLM emette 1-N "tool call" strutturate per turno (7 tool). L'executor le esegue in ordine. | Set di 7 tool (setStateField, respondInfo, respondMeta, requestOverwrite, requestCancel, acknowledgePending, continueFlow) |
| **C** | Hybrid | Intent System per i casi standard; ramo Tool-calling per i casi compound / ambiguità. | Entrambi, con router che decide quale percorso |

## 2. Tabella maestra — scenari × proposte

Legenda: ✅ supportato nativo · ⚙️ supportato ma richiede logica extra · ❌ non supportato (degrada a comportamento attuale) · 🔸 parziale

| # | Scenario conversazionale | Presente in Estinzione | Presente in Consultazione | A) Intent System | B) Tool-calling Agent | C) Hybrid |
|---|---|:---:|:---:|:---:|:---:|:---:|
| S01 | Extraction semplice (*"Bellafronte"*) | ✅ | ✅ | ✅ | ✅ | ✅ |
| S02 | Extraction batched multi-campo (*"Bellafronte, rapporto 01-034…, motivazione 01, 26/04/2026"*) | ✅ | 🔸 (max 2 campi) | ✅ (1 LLM call produce N campi) | ✅ (N tool call `setStateField`) | ✅ |
| S03 | Auto-select single option (pick_ndg con 1 match) | ✅ | ✅ | ✅ (già oggi, core engine) | ✅ | ✅ |
| S04 | Selezione lista esplicita (*"il primo"*, *"Bellafronte Gianluca"*) | ✅ | ✅ | ✅ (pending-resolver) | ✅ (`setStateField` con evidence del match) | ✅ |
| S05 | Topic change con cue (*"no scusa era Rossi"*) | ✅ | ✅ | ✅ | ✅ (`setStateField` con `cueCorrection`) | ✅ |
| S06 | Topic change senza cue (*"il cliente Rossi"* dopo altro) | ✅ | ✅ | ⚙️ (emette pending_overwrite, chiede conferma) | ⚙️ (stesso tool `requestOverwrite`) | ⚙️ |
| S07 | Conferma pending_overwrite (*"sì"*) | ✅ | ✅ | ✅ (intent `affirm`) | ✅ (`acknowledgePending: 'accept'`) | ✅ |
| S08 | Rifiuto pending_overwrite (*"no"*) | ✅ | ✅ | ✅ (intent `deny`) | ✅ (`acknowledgePending: 'reject'`) | ✅ |
| S09 | Meta-question (*"cosa avevi chiesto?"*, *"ripeti"*) | ✅ | ✅ | ✅ (intent `meta` + risposta) | ✅ (`respondMeta(text)`) | ✅ |
| S10 | Info-question semplice (*"quanti rapporti ha?"*) | ✅ | ✅ | ✅ (intent `info` + risposta) | ✅ (`respondInfo(text, citedFields)`) | ✅ |
| S11 | Info-question complessa (*"di che tipo è il rapporto 01-034?"*) | ✅ | 🔸 (su `accounts`) | ✅ | ✅ (`respondInfo` con accesso full state) | ✅ |
| S12 | **COMPOUND: extract + info** (*"Bellafronte, quanti rapporti ha?"*) | ✅ | ✅ | ❌ (sceglie 1 intent, perde l'altro) | ✅ (2 tool call: setStateField + respondInfo) | ⚙️ (router rileva compound, delega a ramo tool-calling) |
| S13 | **COMPOUND: topic change + info** (*"scusa era Rossi, quanti ne ha?"*) | ✅ | ✅ | ❌ | ✅ (2 tool call: setStateField con cue + respondInfo) | ⚙️ |
| S14 | **COMPOUND: 2 campi estratti + ack** (*"NDG 11255521 confermo"* mid-flow, NON al CONFIRM) | ✅ | 🔸 | ⚙️ (extract vince, `confermo` ignorato) | ✅ (setStateField + continueFlow con flag "già confermato") | ⚙️ |
| S15 | Cancel esplicito (*"annulla"*, *"basta"*) | ✅ | ✅ | ✅ (intent `cancel` + pending_cancel) | ✅ (`requestCancel`) | ✅ |
| S16 | Conferma cancel (*"sì annulla"*) | ✅ | ✅ | ✅ (affirm su pending_cancel) | ✅ (`acknowledgePending: 'accept'`) | ✅ |
| S17 | Rifiuto cancel (*"no continuo"*) | ✅ | ✅ | ✅ (deny su pending_cancel) | ✅ (`acknowledgePending: 'reject'`) | ✅ |
| S18 | Conferma finale al CONFIRM (*"sì confermo invio"*) | ✅ | ✅ | ✅ (extract di `confirmed=true` node-local) | ✅ (setStateField confirmed=true) | ✅ |
| S19 | Confermato batched prematuramente (*"confermo sin da ora"* al turno 1) | ✅ (test H1) | ✅ | ✅ (node-local scope → extractor rifiuta, fix recente) | ✅ (tool `setStateField` ha check node-local) | ✅ |
| S20 | Off-topic / saluto (*"ciao"*, *"grazie"*) | ✅ | ✅ | ✅ (intent `continue` + re-prompt) | ✅ (`continueFlow()` + re-prompt) | ✅ |
| S21 | Meta ripetuta (N volte consecutive senza extraction) | ✅ | ✅ | ✅ (loop prevention counter) | ✅ (executor conta i `respondMeta` consecutivi) | ✅ |
| S22 | Value non in catalog (*"NDG 99999999"*) | ✅ | ✅ | ✅ (candidate-policy rifiuta) | ✅ (validation post-tool-call) | ✅ |
| S23 | Value con typo (*"Bellafront"* → singolo match fuzzy) | ✅ | ✅ | 🔸 (dipende da prompt LLM) | 🔸 (stesso) | 🔸 |
| S24 | Ack generico dopo bot message (*"ok"*, *"va bene"*) | ✅ | ✅ | ✅ (intent `continue`) | ✅ (`continueFlow()`) | ✅ |
| S25 | Richiesta help generica (*"aiutami"*, *"come funziona?"*) | 🔸 | 🔸 | ⚙️ (cade su intent `meta`, LLM risponde) | ✅ (`respondMeta` con descrizione flow) | ⚙️ |

### 2.1 Conteggio copertura per proposta

| Proposta | Scenari ✅ | Scenari ⚙️ | Scenari ❌ / 🔸 |
|---|:---:|:---:|:---:|
| **A — Intent System** | 20 / 25 | 2 | 3 (S12, S13, S14) |
| **B — Tool-calling Agent** | 23 / 25 | 2 | 0 (nessuno non gestito) |
| **C — Hybrid** | 21 / 25 | 4 | 0 |

**Osservazione principale**: i 3 scenari **non gestiti** da A (Intent System) sono tutti **compound** (S12, S13, S14). Se compound non è un requisito, A copre il resto perfettamente. Se è richiesto, B è l'unico che lo gestisce nativamente senza router di dispatch.

---

## 3. Dettaglio scenari critici — come appare l'I/O per ciascuna proposta

### 3.1 S12 — Compound: "Bellafronte, quanti rapporti ha?"

Scenario: il bot ha appena chiesto il customerName. L'operatore risponde con il nome **e** chiede info sui rapporti (che il bot potrà caricare solo dopo aver identificato il cliente).

#### A) Intent System

```
LLM output: { userIntent: { type: 'extract' },
              extractedFields: { customerName: 'Bellafronte' } }
```

Il bot applica il campo e avanza a `search_customer`. **L'info-question viene persa**. L'utente deve ripeterla al turno successivo dopo che i rapporti sono stati caricati. Friction.

Alternativa: il classifier sceglie `info`, risponde *"Per sapere quanti rapporti ha devo prima identificare il cliente"*. Ma allora **perde il nome estratto** e l'utente deve ripeterlo. Idem friction.

#### B) Tool-calling Agent

```
LLM output: [
  setStateField(field='customerName', value='Bellafronte', evidence='Bellafronte'),
  respondInfo(text='Mi occorre prima identificare il cliente per verificare i rapporti. Un momento…', citedFields=[]),
]
```

L'executor:
1. Applica `customerName='Bellafronte'` allo state → topic-change trigger + downstream invalidation
2. Emette la bubble di respondInfo (user vede che il bot ha capito entrambe le cose)
3. Avanza al nodo `search_customer` naturalmente

Nel turno successivo, dopo che `accounts` è popolato, l'operatore può chiedere di nuovo *"allora quanti?"* → `respondInfo(text='17 rapporti', citedFields=['accounts'])`. Ma anche senza, l'LLM potrebbe ricordarsi dalla history e rispondere proattivamente al turno 3.

#### C) Hybrid

Il classifier rileva compound (presenza di `customerName` estraibile + question verb pattern). Il router delega al ramo tool-calling per questo turno. Output simile a B. Overhead: doppio prompt engineering (classifier + tool-call).

---

### 3.2 S13 — Compound: "scusa era Rossi, quanti ne ha?"

Scenario: stato attuale `customerName='Bellafronte'`, il bot ha chiesto di selezionare NDG. L'operatore corregge **e** chiede info.

#### A) Intent System

Sceglie 1: o `extract` (applica Rossi, perde la domanda) o `info` (risponde sui rapporti del cliente corrente Bellafronte, ma l'utente ha già detto che era sbagliato). **Rischio di risposta errata**.

#### B) Tool-calling Agent

```
LLM output: [
  setStateField(field='customerName', value='Rossi', evidence='Rossi', cueCorrection='scusa era'),
  respondInfo(text='Ricarico i dati del cliente Rossi e le mostro i rapporti appena pronti.', citedFields=[]),
]
```

Il topic-change invalida i dati di Bellafronte. Il bot risponde onestamente *"devo ricaricare"* invece che dare un numero sbagliato. Behavior corretto.

#### C) Hybrid

Come B tramite ramo tool-calling.

---

### 3.3 S15-S17 — Cancel flow completo

Scenario: l'operatore a metà flow estinzione dice *"annulla"*, il bot chiede conferma, l'operatore conferma o rifiuta.

#### A) Intent System

Turno 1 (user: "annulla"):
```
LLM output: { userIntent: { type: 'cancel', reason: 'utente richiesto' } }
```
Handler `cancelHandler`: emette `pending_cancel` con bubble + quick-replies `[Sì annulla, No continua]`.

Turno 2 (user click "Sì annulla"):
```
LLM output: { userIntent: { type: 'affirm' } }
```
Handler `affirmHandler` legge `sessionRecord.pendingInteraction.type === 'pending_cancel'` → delega a `cancelHandler.confirm` → soft-reset state + emette timeline event `CANCEL_CONFIRMED` + riparte dal nodo root.

#### B) Tool-calling Agent

Turno 1:
```
LLM output: [ requestCancel(reason='utente richiesto') ]
```
Handler `requestCancel`: emette `pending_cancel`.

Turno 2:
```
LLM output: [ acknowledgePending(decision='accept') ]
```
Handler legge pending `pending_cancel` → soft-reset + timeline event.

**Differenza pratica zero** per questo scenario. A e B generano lo stesso comportamento finale con routing diverso.

#### C) Hybrid

Come A (non è un compound, va su intent system puro).

---

### 3.4 S19 — Confermato batched prematuramente

Scenario: user al turno 1 scrive *"ti prego di estinguere il rapporto 01-034-00392400 per Bellafronte motivazione 01 al 26/04/2026, confermo sin da ora"*. Il bot **non deve** auto-submit bypassando il CONFIRM card.

#### A) Intent System

Il field-extractor riceve `stateFields` includendo `confirmed` con `extractionScope: 'node-local'`. Il sever's `verifyFieldAdmissibility` rifiuta `confirmed` perché currentNode != confirm_closure. Risultato: `extractedFields = {customerName, rapportoId, closureReasonCode, closureDate}`, `confirmed` NON estratto, flow pausa al CONFIRM. ✅

#### B) Tool-calling Agent

L'LLM potrebbe essere tentato di emettere `setStateField(field='confirmed', value=true)`. Il validation layer (equivalente del `verifyFieldAdmissibility` attuale) **rigetta la tool call** perché il field ha scope node-local e currentNode non è confirm_closure. Log: `tool-call:rejected reason=field-not-admissible-node-local`. ✅

**Stesso livello di sicurezza**. Le 2 architetture usano lo stesso validation layer, solo il formato di input è diverso.

---

## 4. Tabella — nodi dei flow × proposte

Per ciascun tipo di nodo dei 2 flow, come si comporta ciascuna proposta:

| Tipo nodo | Esempio Estinzione | Esempio Consultazione | A) Intent System | B) Tool-calling Agent | C) Hybrid |
|---|---|---|---|---|---|
| `TOOL` (MCP call) | `search_customer`, `load_accounts`, `submit_closure` | `search_customer`, `generate_report` | Core engine invariato (intent non interferisce con esecuzione tool) | Invariato | Invariato |
| `USER_INPUT` (DataTable) | `pick_ndg`, `pick_rapporto`, `collect_reason` | `pick_ndg` | intent `extract` estrae il valore; auto-select via core | tool `setStateField` applica valore; auto-select via core | Invariato |
| `USER_INPUT` (DatePicker) | `collect_date` | — | intent `extract` estrae la data con parser `absolute-date` | tool `setStateField` per closureDate | Invariato |
| `CONFIRM` (ConfirmCard) | `confirm_closure` | `confirm_shared` | intent `extract` di `confirmed=true` (node-local scope) | tool `setStateField(confirmed=true)` dopo click "Sì" | Invariato |
| Transizione fra nodi | edge DAG | edge DAG | Invariato (main loop dell'executor) | Invariato | Invariato |
| Topic-change trigger | cambio `customerName` | cambio `customerName` | session-store `applyStateOverwriteWithTopicChange` chiamato da handler `extract` | idem da tool `setStateField` | idem |

**Osservazione**: il DAG del flow e l'engine core (tool execution, pauseHint, session persistence) **non cambiano** con nessuna delle 3 proposte. Le proposte differiscono solo **nella modalità di interpretare il messaggio utente** (come JSON monolitico vs come lista di tool call) e nel dispatcher che traduce l'output LLM in modifiche allo state.

---

## 5. Confronto operativo per ciascun flow

### 5.1 Estinzione — quale proposta è migliore?

**Pro Intent System (A)**:
- Copre il 95% dei turni (compound raro)
- Codebase più semplice
- LLM prompt più corto

**Pro Tool-calling Agent (B)**:
- Turno finale "per Bellafronte rapporto 01-034-00392400 motivazione 01 data 2029-04-15 confermo invio" è realisticamente batched con conferma embedded. Serve il compound-aware (setStateField + tentativo di confirmed che viene rifiutato via node-local policy). A gestisce lo stesso caso ma con logica "sceglie extract e perde confirmed" → ora OK perché extractionScope, ma il tool-call è più trasparente nel log

**Winner per estinzione**: **A o B equivalenti**. Compound rari, vincoli di sicurezza stringenti.

### 5.2 Consultazione — quale proposta è migliore?

**Pro Intent System (A)**:
- State minuscolo (7 field) → classifier LLM fa pochi errori
- Turni corti, compound rari

**Pro Tool-calling Agent (B)**:
- Info-question è il pane quotidiano di un flow consultativo. *"Bellafronte, quanti rapporti ha? Di che tipo?"* è realistico
- Compound extract + info è ovvio in consultazione ("cerco Rossi e dimmi se ha conti correnti aperti")
- B gestisce questi scenari al primo turno senza friction

**Winner per consultazione**: **B** con margine concreto. L'UX conversazionale è la killer feature di un flow consultativo.

### 5.3 Cross-flow (estinzione + consultazione + N flow futuri)

Se prevediamo di aggiungere **flow conversazionali aperti** (es. supporto clienti, vendita consultiva), B è la scelta **future-proof**: il tool set è estendibile (+ 1 tool = + 1 capacità) senza riscrivere il dispatcher.

A diventa faticoso quando gli intent crescono oltre 7-8: il discriminated union gonfia, il classifier degrada in accuracy.

---

## 6. Vincoli non-funzionali confrontati

| Criterio | A | B | C |
|---|:---:|:---:|:---:|
| Latenza p95 | ~1.5s | ~1.5s | ~1.8s |
| Costo LLM per turno | 1x | 1x | 1.2x |
| LoC implementazione (core) | ~1.500 | ~1.800 | ~2.200 |
| Testabilità (% test e2e deterministici) | Alta | Alta | Media |
| Debuggabilità log | Media | Alta | Media |
| Rischio hallucination | Medio | Medio-basso (evidence obbligatorio nei tool args) | Medio |
| Backward compatibility con flow esistenti | ✅ | ✅ | ✅ |
| Portabilità LLM provider (Claude/OpenAI) | ✅ | ✅ | ✅ |
| Esistenza pattern nell'ecosistema | Pattern classico CQRS | Standard 2024-25 (Anthropic/OpenAI function calling) | Composizione custom |
| Estensibilità (+ 1 nuovo pattern) | +1 variant + 1 handler | +1 tool | +1 variant o +1 tool (ambiguo dove) |

---

## 7. Raccomandazione finale (contestualizzata ai nostri flow)

> **Scegli in base ai flow futuri previsti**, non solo sui 2 attuali.

| Scenario previsto | Scelta consigliata |
|---|---|
| Solo estinzione + consultazione, niente altro | **A — Intent System** (più semplice, compound rari) |
| + 1-2 flow transazionali simili (apertura conto, sinistro) | **A sufficiente** (pattern identico) |
| + flow consultativi estesi (FAQ, ricerca prodotti, diagnosi) | **B — Tool-calling Agent** (compound + info sono frequenti) |
| + flow a ragionamento autonomo (agent che sceglie i tool MCP) | **B full agent mode** (o ReAct se la scelta dei tool è dinamica) |

**Per il nostro contesto attuale** (banca, 2 flow, probabili altri transazionali + consultativi): **B — Tool-calling Agent** è la scelta più equilibrata. Costo uguale ad A, gestisce compound nativamente, log più leggibili, future-proof per flow più conversazionali.

**Se preferiamo minimizzare il rischio di prompt engineering** e partire con il minimo che funziona, **A — Intent System** è valido per la v1. B si può introdurre in una v2.

## 8. Riferimenti

- [flows-analysis.md](./flows-analysis.md) — analisi dettagliata dei 2 flow (DAG, stateFields, vincoli)
- [flow-copilot-requests.md](./flow-copilot-requests.md) — catalogo richieste al Copilot
- [flow-copilot-mcp-use-cases.md](./flow-copilot-mcp-use-cases.md) — 4 use case pratici
- Test e2e: `packages/tests-e2e/scenarios/ce/flows/interactive-flow/comprehensive-conversations.local.spec.ts` (21 scenari A-G)
