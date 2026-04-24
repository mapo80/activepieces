# Analisi comparata dei flow INTERACTIVE_FLOW

> Documento di riferimento per scegliere l'architettura conversazionale definitiva di INTERACTIVE_FLOW. Analizza i due flow di dominio bancario attualmente implementati o specificati (estinzione rapporto, consultazione cliente), ne estrae pattern comuni e specifici, e definisce i requisiti che la soluzione finale deve soddisfare.

## 1. Scopo

Capire:

- Cosa hanno **in comune** i flow (per far emergere astrazioni riutilizzabili)
- Cosa li rende **diversi** (per dimensionare correttamente la generalizzazione)
- Quali **interazioni conversazionali** (correzione, domanda informativa, cancel, conferma, off-topic) ricorrono in entrambi e come devono essere gestite in modo uniforme

Questa analisi è la base per la scelta fra:

- **A)** Conversation Intent System (classifier + dispatcher + handler)
- **B)** Tool-calling Agent (7 tool, executor orchestra tool-call emesse dall'LLM)
- **C)** Hybrid Intent + Tool-calling

## 2. Inventario dei flow

| Flow | Stato | Fixture JSON | Brief funzionale |
|---|---|---|---|
| Estinzione rapporto | Implementato | `fixtures/flow-templates/estinzione.json` | `packages/tests-e2e/fixtures/prompts/estinzione-functional-brief.md` |
| Consultazione cliente | Specificato (brief), fixture da creare | — | `packages/tests-e2e/fixtures/prompts/consultazione-cliente-functional-brief.md` |

---

## 3. Flow A — Estinzione rapporto bancario

### 3.1 Obiettivo

Guidare l'operatore di filiale nella pratica dispositiva di estinzione di un rapporto: identificazione cliente → scelta rapporto → scelta motivazione → data efficacia → generazione modulo PDF → **invio al sistema centrale**. Flow **dispositivo** (cambia lo stato dei conti in back-office, crea una pratica con ID).

### 3.2 Dati raccolti (stateFields)

| Nome | Tipo | Fonte | Extractable | Parser | Vincoli |
|---|---|---|---|---|---|
| `customerName` | string | operatore | ✅ global | — | regex nome, description: UN VERO CLIENTE |
| `customerMatches` | array | MCP `search_customer` | ❌ catalog | — | populated by tool |
| `ndg` | string (6-10 digit) | operatore o auto-select | ✅ global | `ndg` | enumFrom customerMatches |
| `profile` | object | MCP `get_profile` | ❌ catalog | — | populated by tool |
| `accounts` | array | MCP `list_accounts` | ❌ catalog | — | populated by tool |
| `rapportoId` | string (XX-XXX-XXXXXXXX) | operatore | ✅ global | `rapportoId` | enumFrom accounts |
| `closureReasons` | array | MCP `list_closure_reasons` | ❌ catalog | — | populated by tool |
| `closureReasonCode` | string (2 digit) | operatore | ✅ global | `reason-code-cued` | enumFrom closureReasons |
| `closureReasonText` | string | operatore (fallback) | ✅ global | — | descrizione libera → mapping a code |
| `closureDate` | date (ISO) | operatore | ✅ global | `absolute-date` | oggi ≤ date ≤ today + 5y |
| `moduleBase64` | string | MCP `generate_module` | ❌ catalog | — | PDF generato |
| `confirmed` | boolean | operatore | ✅ **node-local** | — | accettato SOLO al nodo CONFIRM |
| `caseId` | string | MCP `submit_closure` | ❌ catalog | — | ID pratica creata |

**13 stateFields totali**, di cui 6 extractable global, 1 extractable node-local, 6 non-extractable (alimentati da tool MCP).

### 3.3 DAG dei nodi (11 nodi)

```
search_customer (TOOL)
    consuma: customerName
    produce: customerMatches
         │
         ▼
pick_ndg (USER_INPUT, DataTable su customerMatches)
    consuma: customerMatches
    produce: ndg
         │
         ├──────────────────┬──────────────────┐
         ▼                  ▼                  │
load_profile (TOOL)   load_accounts (TOOL)     │
    consuma: ndg          consuma: ndg         │
    produce: profile      produce: accounts    │
         │                  │                  │
         └─────────┬────────┘                  │
                   ▼                           │
          pick_rapporto (USER_INPUT)           │
              consuma: accounts                │
              produce: rapportoId              │
                   │                           │
                   ▼                           │
            load_reasons (TOOL)                │
                consuma: rapportoId (fix topologico)
                produce: closureReasons        │
                   │                           │
                   ├─────────────────┐         │
                   ▼                 ▼         │
      collect_reason           collect_date    │
       (USER_INPUT)            (USER_INPUT,    │
        consuma: closureReasons, DatePickerCard)
                  rapportoId    consuma: closureReasons,
        produce: closureReasonCode              rapportoId
                                 produce: closureDate
                   │                 │         │
                   └─────────┬───────┘         │
                             ▼                 │
                    generate_pdf (TOOL)        │
                        consuma: ndg, rapportoId,
                                 closureReasonCode,
                                 closureDate   │
                        produce: moduleBase64  │
                             │                 │
                             ▼                 │
                    confirm_closure (CONFIRM)  │
                        consuma: moduleBase64, │
                                 profile       │
                        produce: confirmed     │
                             │                 │
                             ▼                 │
                       submit (TOOL) ◄─────────┘
                           consuma: confirmed, ndg,
                                    rapportoId,
                                    closureReasonCode,
                                    closureDate
                           produce: caseId [terminal]
```

**Caratteristiche topologiche**:

- **11 nodi**: 6 TOOL (MCP), 4 USER_INPUT (DataTable, DataTable, DataTable, DatePicker), 1 CONFIRM (ConfirmCard)
- **Fan-out** dopo pick_ndg: load_profile e load_accounts partono in parallelo (entrambi consumano `ndg`)
- **Fan-out** dopo load_reasons: collect_reason e collect_date partono in parallelo (dopo il fix topologico entrambi dipendono da rapportoId + closureReasons)
- **Join multipli** prima di generate_pdf (4 state fields attesi) e submit (5 state fields attesi)
- **1 nodo CONFIRM** obbligatorio con stateField node-local (`confirmed`)
- **1 terminal** (submit emette caseId, flow chiuso con successo)

### 3.4 Catalog-based validation (enumFrom)

3 campi hanno validazione contro un catalog caricato a runtime:

- `ndg` → `customerMatches[].ndg`
- `rapportoId` → `accounts[].codiceRapportoNonNumerico`
- `closureReasonCode` → `closureReasons[].code`

Regole: valore accettato solo se presente nel catalog corrispondente. Il catalog è popolato da un TOOL upstream. Se non ancora popolato, deferred validation (accetta tentativamente se pattern matcha, rivalida dopo il tool).

### 3.5 Interazioni conversazionali attese

Ricavate dal brief + test e2e esistenti (`comprehensive-conversations.local.spec.ts`):

| Categoria | Esempi reali | Frequenza |
|---|---|---|
| **Extraction semplice** | *"Bellafronte"*, *"01-034-00392400"*, *"26/04/2026"*, *"motivazione 01"* | Maggioranza dei turni |
| **Extraction batched** | *"estingui per Bellafronte il rapporto 01-034-00392400 motivazione 01 al 26/04/2026"* | Comune (5-10% dei flow) |
| **Topic change con cue** | *"no scusa il cliente era Rossi"*, *"aspetta, rapporto 02-045"*, *"in effetti motivazione 02"* | Occasionale (3-5%) |
| **Topic change senza cue** | *"il cliente Rossi, il rapporto 02-045"* (dopo aver già estratto altri valori) | Raro |
| **Rifiuto valore** | *"no non era quello"* durante pending_overwrite | Raro |
| **Meta-question** | *"cosa mi avevi chiesto?"*, *"ripetimi"*, *"non ho capito"* | Occasionale (2-3%) |
| **Info-question** | *"quanti rapporti ha il cliente?"*, *"di che tipo è il rapporto 01-034?"* | Occasionale (2-3%) |
| **Off-topic / saluto** | *"ciao"*, *"grazie"*, *"buongiorno"* | Raro |
| **Cancel** | *"annulla"*, *"ricomincio"*, *"basta"* | Raro |
| **Conferma finale** | *"sì, confermo l'invio"*, *"confermo"*, *"procedi"* | Obbligatoria al nodo CONFIRM |
| **Selezione da lista** | *"il primo"*, *"l'ultimo"*, *"Bellafronte Gianluca"*, diretta click sulla card | Dipende da singleOptionStrategy |

### 3.6 Vincoli business critici

1. **Catalog autoritativo**: mai accettare codici motivazione non presenti in closureReasons
2. **Rapporto deve appartenere al cliente**: rapportoId ∈ accounts
3. **NDG deve esistere**: ndg ∈ customerMatches
4. **Data nel range**: `today ≤ closureDate ≤ today + 5y`
5. **Conferma esplicita**: `confirmed` estratto SOLO al nodo confirm_closure (scope node-local) — mai al turno 1 batched
6. **No hallucination**: mai inferire dati; chiedi se manca

---

## 4. Flow B — Consultazione cliente

### 4.1 Obiettivo

Guidare l'operatore nella consultazione **informativa** di un cliente: identificazione cliente → caricamento profilo e rapporti → generazione report PDF → conferma condivisione. Flow **non dispositivo**: nessun tool che modifichi lo stato dei conti; nessun submit al sistema centrale; la conferma finale è sulla condivisione esterna.

### 4.2 Dati raccolti (stateFields)

| Nome | Tipo | Fonte | Extractable | Vincoli |
|---|---|---|---|---|
| `customerName` | string | operatore | ✅ global | come flow A |
| `customerMatches` | array | MCP `search_customer` | ❌ catalog | — |
| `ndg` | string | operatore o auto-select | ✅ global | enumFrom customerMatches |
| `profile` | object | MCP `get_profile` | ❌ catalog | — |
| `accounts` | array | MCP `list_accounts` | ❌ catalog | — |
| `reportBase64` | string | MCP (es. `generate_customer_report`) | ❌ catalog | PDF report |
| `sharedConfirmed` | boolean | operatore | ✅ node-local | conferma condivisione |

**7 stateFields totali** (vs 13 di estinzione). Nessuno dei catalog specifici di estinzione (closureReasons, motivazione, data).

### 4.3 DAG dei nodi (proposto, ~6 nodi)

```
search_customer (TOOL)
    consuma: customerName
    produce: customerMatches
         │
         ▼
pick_ndg (USER_INPUT, singleOptionStrategy='auto')
    consuma: customerMatches
    produce: ndg
         │
         ├──────────────────┐
         ▼                  ▼
load_profile (TOOL)   load_accounts (TOOL)
    consuma: ndg          consuma: ndg
    produce: profile      produce: accounts
         │                  │
         └─────────┬────────┘
                   ▼
         generate_report (TOOL)
             consuma: profile, accounts
             produce: reportBase64
                   │
                   ▼
         confirm_shared (CONFIRM, ConfirmCard su reportBase64)
             consuma: reportBase64, profile
             produce: sharedConfirmed
                   │
                   ▼
              [terminal]
```

**Caratteristiche topologiche**:

- **6 nodi**: 4 TOOL, 1 USER_INPUT, 1 CONFIRM
- **1 fan-out** (dopo pick_ndg): parallel load_profile + load_accounts
- **1 join** prima di generate_report
- **Catena più corta** di estinzione (nessuna motivazione, nessuna data, nessun submit dispositivo)
- **Terminale sulla CONFIRM** (non esiste il nodo submit a valle)

### 4.4 Catalog-based validation

Solo 1 campo ha enumFrom: `ndg` → `customerMatches[].ndg`. Stesso pattern di estinzione ma scope più ristretto.

### 4.5 Interazioni conversazionali attese

Sostanzialmente le stesse di estinzione, con 2 differenze:

| Categoria | Note specifiche |
|---|---|
| **Extraction / batched** | Meno campi da estrarre → turni più brevi, meno chance di "batched full" |
| **Topic change con/senza cue** | Identico (solo customerName può cambiare) |
| **Meta-question** | Identica |
| **Info-question** | Invece di *"quanti rapporti?"* → *"quanti match?"* (più focalizzato perché lo state è più piccolo) |
| **Off-topic** | Identico |
| **Cancel** | Identico (più leggero da "perdere" perché nessuna operazione dispositiva) |
| **Conferma finale** | Semantica diversa: non "invia pratica" ma "conferma di aver condiviso il report" → il bot non può verificare, si fida della conferma |

### 4.6 Vincoli business

1. **Sola consultazione**: nessun tool dispositivo. Filosofia read-only per lo state esterno.
2. **Report PDF obbligatorio**: non chiudibile senza generarlo.
3. **Conferma esplicita**: come estinzione (scope node-local su `sharedConfirmed`).
4. **No hallucination**: come estinzione.

---

## 5. Analisi comparata

### 5.1 Matrice di similarità

| Dimensione | Estinzione | Consultazione | Commento |
|---|---|---|---|
| Numero nodi | 11 | 6 | Consultazione ~55% di estinzione |
| Numero stateFields | 13 | 7 | Consultazione ~54% di estinzione |
| Tool MCP distinti | 6 | 4 | search, get_profile, list_accounts condivisi |
| Tool MCP **in comune** | 3 (search_customer, get_profile, list_accounts) | 3 | Identità completa sui primi 3 step |
| Nodi USER_INPUT | 4 | 1 | Differenza strutturale |
| Nodi CONFIRM | 1 | 1 | Pattern identico |
| Nodi TOOL dispositivi | 1 (submit) | 0 | Differenza filosofica read vs write |
| stateFields node-local | 1 (`confirmed`) | 1 (`sharedConfirmed`) | Stesso pattern |
| stateFields extractable globali | 5 | 2 | Consultazione molto meno input operatore |
| Catalog-based validation | 3 campi | 1 campo | |
| Pre-parser usati | ndg, rapportoId, reason-code-cued, absolute-date | ndg | Subset |
| Fan-out topologici | 2 | 1 | Consultazione più lineare |

### 5.2 Pattern comuni a entrambi

Questi sono i "mattoncini" che la soluzione conversazionale deve gestire come invarianti, indipendenti dal dominio:

1. **Identificazione cliente tramite nome + disambiguazione NDG**: identico, stesso tool MCP, stesso pattern USER_INPUT con `singleOptionStrategy`
2. **Caricamento parallelo profile + accounts**: identico
3. **Validazione enumFrom** (ndg ∈ customerMatches)
4. **Nodo CONFIRM terminale con stateField node-local**
5. **Topic change su customerName con invalidazione state downstream**
6. **Meta-question / info-question / cancel** — richieste conversazionali agnostiche al dominio
7. **Generazione PDF via MCP** → bubble con blocks-v1 pdf-viewer
8. **Chain of thought in italiano** nel chat drawer

### 5.3 Differenze strutturali

1. **Lunghezza catena post-pick_ndg**:
   - Estinzione: 3 sotto-catene (scelta rapporto, scelta motivazione+data, generazione+submit)
   - Consultazione: 1 sotto-catena (generate_report + confirm)

2. **Filosofia read vs write**:
   - Estinzione: **dispositivo** (modifica stato esterno via submit_closure). Vincoli di sicurezza critici (conferma esplicita, catalog autoritativo)
   - Consultazione: **read-only** (no side effect esterni). Conferma è soft (si fida dell'operatore)

3. **Densità di campi operatore**:
   - Estinzione: 5 campi extractable (customerName, ndg, rapportoId, closureReasonCode, closureDate)
   - Consultazione: 2 campi extractable (customerName, ndg)

4. **Ricchezza catalog**: estinzione dipende da 3 catalog (customerMatches, accounts, closureReasons), consultazione solo da 1 (customerMatches)

5. **Terminal semantics**:
   - Estinzione: success = caseId emesso dal sistema centrale (fact check-able)
   - Consultazione: success = operatore dice "sì ho condiviso" (trust-based)

### 5.4 Complexity class

Entrambi i flow rientrano nella stessa classe: **DAG lineare con fan-out/join limitati, state type mixed (extractable + catalog), terminale su CONFIRM o TOOL**. Consultazione è un **sottoinsieme** strutturale di estinzione: se l'engine supporta estinzione, supporta consultazione senza modifiche.

---

## 6. Process flow diagram (pattern astratto)

```
                    ┌─────────────────────────────┐
                    │   IDENTIFICAZIONE ENTITÀ    │
                    │  (nome → search → match)    │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │   DISAMBIGUAZIONE ID        │
                    │  (pick o auto-select)       │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │   CARICAMENTO CATALOG       │
                    │  (profile, accounts, ...)   │
                    │  in parallelo / sequenza    │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │  RACCOLTA PARAMETRI         │
                    │  (zero o più USER_INPUT)    │
                    │  ciascuno con validation    │
                    │  contro catalog caricato    │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │  GENERAZIONE ARTEFATTO      │
                    │  (PDF, report, ...)         │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │  CONFERMA OPERATORE         │
                    │  (CONFIRM card)             │
                    │  node-local stateField      │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │  AZIONE FINALE              │
                    │  (TOOL dispositivo o        │
                    │   terminale read-only)      │
                    └─────────────────────────────┘
```

Sopra il DAG, in ogni istante, possono avvenire **interazioni conversazionali trasversali**:

- Topic change (cambio valore già estratto)
- Meta-question (domanda sulla conversazione)
- Info-question (domanda su state caricato)
- Cancel (richiesta di annullare)
- Off-topic / saluto / ack generico

Queste sono **ortogonali** al DAG del flow. La soluzione conversazionale deve gestirle **in modo uniforme** senza che ogni flow debba specificarle.

---

## 7. Requisiti per la soluzione conversazionale

Dalla lettura dei 2 brief + strutture, la soluzione finale deve garantire:

### 7.1 Requisiti funzionali

| # | Requisito | Copertura attuale | Priorità |
|---|---|---|---|
| F1 | Estrazione di campi extractable con validation contro catalog | ✅ già oggi | — |
| F2 | Auto-select di singolo match in pick_* | ✅ già oggi | — |
| F3 | Topic change: invalidate downstream state | ⚠️ state sì, executedNodeIds no | Alta |
| F4 | Conferma esplicita al nodo CONFIRM, no auto-submit su batched | ✅ ora (dopo fix extractionScope) | — |
| F5 | Risposta a meta-question senza avanzare il flow | ❌ metaAnswer ignorato | Alta |
| F6 | Risposta a info-question usando state caricato | ❌ non esistente | Media |
| F7 | Cancel flow esplicito con conferma | ❌ non esistente | Alta |
| F8 | Compound intent ("cambio X e dimmi Y") | ❌ non supportato | Media |
| F9 | Runtime timeline UI visibilità per ogni intent non-extract | ⚠️ parziale (solo node events) | Alta |
| F10 | Loop prevention su meta/info consecutive | ❌ non esistente | Media |

### 7.2 Requisiti non-funzionali

| # | Requisito | Valore target |
|---|---|---|
| NF1 | Latenza p95 per turno | ≤ 3s (incluso LLM call) |
| NF2 | Costo LLM per turno | ≤ $0.003 (media) |
| NF3 | Test e2e deterministici | 100% dei test riproducibili |
| NF4 | Zero breaking per flow esistenti | Fixture estinzione non modificato |
| NF5 | Nessuna logica domain-specific nel core engine | Tutto parametrizzato da settings del flow IF |
| NF6 | Compatibilità cross-flow | Lo stesso codice deve funzionare su estinzione e consultazione **senza modifiche** |

### 7.3 Matrice di genericità

Per ciascun pattern, la soluzione deve essere "core-level" (condivisa) o "flow-level" (per-flow via settings):

| Pattern | Core / Flow | Come |
|---|---|---|
| Topic change detection (cue IT/EN) | Core | regex universali in overwrite-policy |
| State invalidation downstream | Core | dependency graph da nodes[] |
| Meta-question answering | Core | LLM usa systemPrompt + history, no domain |
| Info-question answering | Core | LLM usa currentState + stateFields descriptions |
| Cancel flow | Core | reset state + restart da nodo root |
| Auto-select single option | Core (già) | logica su pick_* node |
| Validation catalog (enumFrom) | Core (già) | candidatePolicy |
| Linguaggio italiano / registro bancario | Flow | systemPrompt + flowLabel |
| Nome dei nodi ("Cerca cliente") | Flow | displayName |
| Descrizioni dei campi | Flow | stateFields[].description |
| Tool MCP chiamati | Flow | settings.mcpGatewayId + nodes[].tool |

**Solo `systemPrompt`, `flowLabel`, `displayName`, `description`, `tool`, `mcpGatewayId` sono flow-specific**. Tutto il resto è core.

---

## 8. Implicazioni per la scelta architetturale

Incrociando l'analisi con le 3 opzioni discusse:

### 8.1 Opzione A — Intent System

Supporta bene F3, F5, F7, F9, F10. **Non supporta F8** (compound): per estinzione è raro, per consultazione può emergere (*"Bellafronte, quanti rapporti ha?"*).

### 8.2 Opzione B — Tool-calling Agent

Supporta **tutti** i requisiti funzionali, incluso F8 nativo. Adatto a entrambi i flow senza differenze. Il **tool set è identico** fra estinzione e consultazione (i 7 tool non cambiano), solo i parametri `field` (argument di `setStateField`) cambiano perché lo state è diverso.

### 8.3 Opzione C — Hybrid

Supporta tutti i requisiti ma con complessità di manutenzione doppia. I 2 flow sono abbastanza simili da non giustificarla — non stiamo servendo flow di "classi" diverse (es. un flow transazionale + un flow conversazionale aperto).

### 8.4 Raccomandazione (neutra, derivata dai requisiti)

- I 2 flow sono **omogenei come classe di complessità** (DAG lineare, state misto, CONFIRM obbligatorio)
- Il 90% dei loro requisiti conversazionali è **identico**
- Compound intent (*F8*) ha **valore marginale** per estinzione, **valore concreto** per consultazione (info-question più frequenti)
- Tool-calling Agent è **il solo approccio che copre F8** senza complessità aggiuntiva rispetto all'Intent System

**Lettura**: se fra i 2 flow non ci fosse consultazione, Intent System basterebbe. Con consultazione sul tavolo + probabili flow futuri di "pura informazione", **Tool-calling Agent è giustificato**.

---

## 9. Parametri per dimensionare la generalizzazione

**Quanto "generica" deve essere la soluzione?**

- Se prevediamo: solo estinzione + consultazione → Intent System copre il 95%
- Se prevediamo: + 1 flow transazionale simile (es. apertura conto) → Intent System copre ancora bene
- Se prevediamo: + flow conversazionali aperti (es. consulenza commerciale, FAQ guidate) → **Tool-calling Agent** è necessario
- Se prevediamo: + flow a ragionamento autonomo (agent che decide quali tool MCP chiamare) → **ReAct loop** o Claude Agent SDK full

**Attualmente i 2 flow specificati sono entrambi "workflow guidati a DAG"**, quindi Intent System o Tool-calling coprono. Tool-calling ha il vantaggio di essere future-proof per eventuali flow più conversazionali.

---

## 10. Prossimi passi (per continuare il design)

1. Validare l'analisi con stakeholder di dominio (l'analisi è corretta sulla semantica? Mancano scenari reali?)
2. Stimare la frequenza prevista di ogni categoria di interazione conversazionale (estimate con operatori di filiale: quanto spesso chiedono info mid-flow?)
3. Decidere l'architettura (Intent System / Tool-calling / Hybrid) sulla base dell'importanza di F8 (compound) e di flow futuri previsti
4. Implementare la soluzione + secondo fixture (`consultazione-cliente.json`) come proof cross-flow
5. Misurare produzione: N turni, % classification errati, latenza, costo. Iterare.
