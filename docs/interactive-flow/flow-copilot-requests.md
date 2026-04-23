# Flow Copilot — catalogo delle richieste

Questo documento elenca le richieste che puoi fare al Flow Copilot (pannello destro del builder, aperto con ⌘K / Ctrl+K). Ogni sezione include:

- **Quando si applica** (scope attivo in base allo stato del flow)
- **Esempi di prompt** da copia-incollare
- **Cosa aspettarsi** come risposta del Copilot

---

## 🔵 Scope 1 — `EMPTY_OR_NEW` (flow vuoto, solo trigger)

Si attiva quando apri il Copilot su un flow appena creato (trigger `Empty Trigger` o similare, senza azioni).

### 1.1 Creare un flow completo da un brief funzionale

**Quando**: hai una specifica business in linguaggio naturale e vuoi che il Copilot costruisca tutto il flow IF (state fields + nodi + systemPrompt + binding).

**Come**: incolla un brief funzionale di 500-1500 parole strutturato (Obiettivo, Dati necessari, Passi della conversazione, Vincoli, Tono). Gli esempi pronti stanno in:

- `packages/tests-e2e/fixtures/prompts/estinzione-functional-brief.md` — pratica di estinzione rapporto bancario
- `packages/tests-e2e/fixtures/prompts/consultazione-cliente-functional-brief.md` — consultazione cliente + generazione report

**Esempi di prompt**:

```
[incolla qui il contenuto di estinzione-functional-brief.md]
```

```
Devi costruire un flow interattivo per gestire pratiche di assistenza
tecnica in filiale. L'operatore deve inserire l'email del cliente, il
sistema carica il profilo, l'operatore sceglie categoria (hardware /
software / account) e priorità (bassa / media / alta / urgente),
descrive il problema, allega eventuale screenshot, e conferma l'invio
al sistema ITSM che restituisce il numero di ticket.
...
[continua sezioni Dati necessari / Passi / Vincoli / Tono]
```

**Cosa aspettarsi**:

- Una card "thinking" (tre pallini animati)
- Sequenza di tool-call nella chat (`list_mcp_gateways` → `list_mcp_tools` → `insert_interactive_flow_action` → N × `add_state_field` → `set_message_input` → `set_system_prompt` → N × `add_node` → `validate_patch` → `finalize`)
- Il canvas si aggiorna **in tempo reale** durante lo streaming — vedrai i nodi comparire progressivamente
- Summary card **VERDE** con testo tipo "Flow pronto: N modifiche applicate"
- Tempo atteso: ~1-5 min (varia con latency del provider LLM)

### 1.2 Richieste conversazionali (greetings, domande)

**Quando**: vuoi verificare che il Copilot sia attivo, o chiedere chiarimenti.

**Esempi**:

```
Ciao
```

```
Cosa sai fare?
```

```
Come funziona il flow interattivo?
```

**Cosa aspettarsi**: risposta testuale in italiano **senza card riassuntiva** (niente verde, niente rosso). Il Copilot usa lo status `info` per queste turn — il testo appare nella bubble del messaggio assistente, senza cornice di riepilogo.

---

## 🟢 Scope 2 — `INTERACTIVE_FLOW` (flow esistente con azione IF)

Si attiva quando apri il Copilot su un flow che ha già un'azione `INTERACTIVE_FLOW` configurata. Ora sei in modalità "editor AI": puoi modificare atomicamente qualsiasi parte del flow.

### 2.1 Aggiungere uno state field

**Esempi**:

```
aggiungi un campo customerEmail di tipo string estraibile con
pattern ^[^@]+@[^@]+\.[^@]+$ e descrizione "Email del cliente"
```

```
aggiungi un campo iban estraibile di tipo string con pattern
^IT\d{2}[A-Z0-9]+$ e label "IBAN destinazione"
```

```
aggiungi un catalog field closureReasons di tipo array non estraibile,
contiene la lista delle motivazioni di estinzione dal sistema bancario
```

```
aggiungi un campo confirmed booleano node-local estraibile che serve
come flag di conferma finale
```

### 2.2 Aggiornare uno state field esistente

**Esempi**:

```
sul campo closureDate aggiungi il pattern ^\d{4}-\d{2}-\d{2}$
```

```
per il field customerName, aggiungi una description più esplicita con
esempi valid/invalid: validi Bellafronte, Mario Rossi; invalidi verbi
come procedere, saluti come ciao
```

```
rimuovi il parser 'ner-name' da customerName — non serve
```

### 2.3 Aggiungere un nodo TOOL (chiamata MCP)

**Esempi**:

```
aggiungi un nodo TOOL chiamato search_customer che consuma customerName
e produce customerMatches, bindato al tool banking-customers/search_customer
```

```
aggiungi un nodo generate_pdf di tipo TOOL che consuma ndg, rapportoId,
closureReasonCode, closureDate e produce moduleBase64, bindato al tool
banking-operations/generate_module
```

### 2.4 Aggiungere un nodo USER_INPUT con DataTable

**Esempi**:

```
aggiungi un nodo pick_customer USER_INPUT con render DataTable su
sourceField customerMatches, colonne ndg e name. Deve produrre ndg.
```

```
aggiungi un nodo collect_reason USER_INPUT con DataTable su closureReasons,
colonne code e label. Consuma closureReasons, produce closureReasonCode.
```

### 2.5 Aggiungere un nodo DatePickerCard

**Esempi**:

```
aggiungi un nodo collect_date USER_INPUT con render DatePickerCard vuoto,
consuma closureReasons come barriera topologica, produce closureDate.
```

### 2.6 Aggiungere un nodo CONFIRM finale

**Esempi**:

```
aggiungi un nodo confirm_closure CONFIRM con render ConfirmCard sourceField
moduleBase64, consuma moduleBase64 e profile, produce confirmed.
```

### 2.7 Aggiornare un nodo esistente

**Esempi**:

```
sul nodo collect_date cambia stateInputs da [] a [closureReasons]
```

```
sul nodo pick_customer imposta singleOptionStrategy: 'auto'
```

```
sul nodo generate_pdf aggiorna toolParams per includere anche profile
come {kind:'state',field:'profile'}
```

### 2.8 Modificare il systemPrompt dell'extractor

**Esempi**:

```
aggiorna il systemPrompt: aggiungi la regola "closureDate deve essere una
data ISO YYYY-MM-DD compresa fra oggi e massimo 5 anni nel futuro"
```

```
rendi il systemPrompt più esplicito sui casi invalidi: aggiungi che
"procedere", "invia", "conferma" non sono nomi di cliente
```

### 2.9 Modificare bindings / gateway

**Esempi**:

```
cambia il messageInput a {{trigger.input.message}} invece di
{{trigger.message}}
```

```
imposta il locale del flow a 'en' invece di 'it'
```

```
imposta mcpGatewayId al gateway "Agentic Engine Banking (local)"
```

### 2.10 Eliminare qualcosa

**Esempi**:

```
elimina il campo closureReasonText, non serve per il flusso corrente
```

```
elimina il nodo generate_pdf, useremo un tool diverso
```

⚠️ Il Copilot rifiuta operazioni che romperebbero il flow (es. eliminare un field ancora usato come stateInput di un nodo downstream) e suggerisce alternative più sicure.

### 2.11 Validare il flow

**Esempi**:

```
valida il flow corrente e dimmi se ci sono errori
```

```
controlla se ci sono field orfani o nodi con stateInputs non prodotti
```

---

## 🧪 Richieste di esempio per testing (end-to-end)

### Flow bancario completo da zero (scope EMPTY_OR_NEW)

Incolla nel panel Copilot:

```bash
cat packages/tests-e2e/fixtures/prompts/estinzione-functional-brief.md | pbcopy
# poi ⌘V nel panel e Invio
```

### Flow consultazione non-estinzione (scope EMPTY_OR_NEW)

```bash
cat packages/tests-e2e/fixtures/prompts/consultazione-cliente-functional-brief.md | pbcopy
```

### Smoke rapido per verificare che il Copilot risponde (scope EMPTY_OR_NEW)

```
aggiungi un campo customerName di tipo string estraibile con pattern
^[A-Za-zÀ-ÿ' -]+$
```

Dovrebbe:
- Fallire (non siamo in scope INTERACTIVE_FLOW — il flow non ha ancora un'azione IF)
- Oppure, se hai già cliccato su un'azione IF nel canvas, applicare la modifica

---

## 🎯 Cosa NON fare (o limitazioni)

- **Non chiedere code generation pura** (es. "scrivi una funzione TypeScript"). Il Copilot gestisce solo la struttura del flow IF, non il codice piece.
- **Non chiedere di integrare servizi esterni non-MCP**. Tutti i nodi TOOL devono essere bindati a tool disponibili sul `mcpGatewayId` (scopribili via `list_mcp_tools`).
- **Non inventare nomi di tool**. Se il tool che ti serve non è nel gateway, il Copilot lo dichiara esplicitamente invece di inventarlo.
- **Non aspettarsi che il Copilot modifichi flow non-INTERACTIVE_FLOW**. Il supporto attuale è solo per il tipo di azione INTERACTIVE_FLOW; flow basati su pieces standard non sono gestiti.

---

## 📊 Segnali visivi nella chat

| Segnale | Significato |
|---|---|
| Card 🤔 + testo italiano breve (bubble assistant, no cornice) | Conversazione normale (saluti, Q&A, chiarimenti) — `status: info` |
| Card verde "Flow pronto" con bottoni Undo | Successo: il flow è stato aggiornato/creato correttamente |
| Card ambra "Flow creato con correzioni" | Parziale: il flow è usabile ma ha avuto qualche errore durante la generazione (auto-corretto) |
| Card rossa "Operazione non completata" | Errore reale: nessuna modifica applicata. Leggi il testo per il motivo |
| Tre pallini animati nel pannello | Il Copilot sta lavorando (streaming in corso). Lascia finire — interrompere può corrompere il flow |
| Card tool-call espandibile con ✓ / ⏳ / ✗ | Dettaglio di ciascun passo: espandi per vedere args e result |

---

## 🔧 Undo e correzioni

Dopo una summary verde/ambra, la card mostra due bottoni (il secondo solo se hai fatto modifiche manuali dopo l'apertura della sessione):

- **"Annulla solo le modifiche del copilot"** — replay delle inverse-op per tornare allo stato pre-conversazione, preservando le modifiche manuali interleaved
- **"Ripristina stato iniziale"** — overwrite distruttivo con lo snapshot di inizio sessione; cancella anche le modifiche manuali

Se non sei soddisfatto del risultato, usa l'Undo senza paura di corrompere il flow — tutte le operazioni del Copilot sono idempotenti e invertibili.

---

## 💡 Tip operativi

1. **Sessione per flow**: quando cambi flow nel builder, la chat del Copilot si resetta automaticamente. Ogni flow ha la sua conversazione.
2. **⌘K ovunque**: puoi aprire/chiudere il Copilot con Cmd+K (Mac) o Ctrl+K (Linux/Win) da qualsiasi punto del builder.
3. **Canvas live**: durante la generazione (scope EMPTY_OR_NEW), guarda il canvas — i nodi compaiono progressivamente. Se non si aggiornano, probabilmente c'è un problema di cache/network; un reload (⌘R) sincronizza col server.
4. **Brief non tecnico**: il Copilot funziona meglio con brief scritti in linguaggio business (no termini tecnici come "stateField", "enumFrom", ecc.). Parla di "dati da raccogliere", "passi della conversazione", "vincoli", "tono".
5. **Flow complessi multi-turno**: per flow con 10+ state field, il Copilot può impiegare 3-5 min. Lascia finire senza interrompere. Se ti sembra bloccato, controlla i tool-call nel pannello — se continuano a essere emessi, sta lavorando.
