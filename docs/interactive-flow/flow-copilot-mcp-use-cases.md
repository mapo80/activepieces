# Flow Copilot — 4 use case pronti da provare

Quattro scenari dal più semplice al più complesso. Per ognuno trovi:

- **Setup**: cosa devi avere aperto prima di iniziare
- **Cosa scrivere nel Copilot**: il testo esatto da incollare nel pannello chat (⌘K)
- **Cosa succede**: sequenza attesa + tempo stimato

Il gateway MCP `Agentic Engine Banking (local)` espone 8 tool, elencati in fondo al documento per riferimento.

---

## ⭐ UC-1 — Aggiungere un campo a un flow esistente

> **Complessità**: ★☆☆☆☆ (1 tool-call, ~20 sec)

### Setup
- Apri un flow che ha già un'azione `INTERACTIVE_FLOW` configurata (es. un flow estinzione già creato)
- Premi ⌘K → pannello Copilot si apre con scope `INTERACTIVE_FLOW`

### Cosa scrivere nel Copilot

```
aggiungi un campo customerEmail di tipo string estraibile con pattern ^[^@]+@[^@]+\.[^@]+$ e descrizione "Email del cliente da contattare per comunicazioni relative alla pratica"
```

### Cosa succede

1. Card ⏳ `read_flow_settings` → ✓
2. Card ⏳ `add_state_field({name:"customerEmail", type:"string", extractable:true, pattern:"^[^@]+@[^@]+\\.[^@]+$", description:"Email del cliente..."})` → ✓
3. Il pannello **State fields** della step-settings si aggiorna live con la nuova riga `customerEmail`
4. Card verde "Flow pronto: 1 modifica applicata" + bottone **Annulla solo le modifiche del copilot**

---

## ⭐⭐ UC-2 — Flow minimo: menu operazioni (homepage)

> **Complessità**: ★★☆☆☆ (1 tool banking + 1 USER_INPUT, ~1 min)
> **Tool MCP usati**: `platform/show_suggestions`

### Setup
- Crea un flow **vuoto** (solo trigger `Empty Trigger`)
- ⌘K → pannello Copilot → scope `EMPTY_OR_NEW`

### Cosa scrivere nel Copilot

```
Devi costruire un flow interattivo che fa da menu operazioni per l'operatore di filiale.

Obiettivo: mostrare all'operatore l'elenco delle operazioni disponibili (pratiche, consultazioni, automazioni) come una tabella cliccabile. L'operatore sceglie una voce; il bot registra la scelta e saluta. Non esegue operazioni: è una pagina di navigazione.

Utenti: operatori di filiale, chat in italiano, tono bancario professionale.

Dati necessari:
1. Elenco dei suggerimenti disponibili (caricato dal sistema; contiene id, etichetta e descrizione per ogni voce).
2. Voce selezionata (l'id del suggerimento scelto dall'operatore).

Passi della conversazione:
1. Il bot saluta l'operatore e carica dal sistema la lista dei suggerimenti disponibili.
2. Mostra la lista in una tabella cliccabile con due colonne: etichetta e descrizione.
3. L'operatore clicca una riga; il bot conferma la scelta e chiude.

Vincoli: flow di sola navigazione, niente conferma finale esplicita (la selezione È la conferma). Tutto in italiano.

Tono: amichevole ma bancario. Esempio di apertura: "Benvenuto. Ecco le operazioni che posso avviare per te oggi:".
```

### Cosa succede

1. Il Copilot chiama `list_mcp_gateways` → `list_mcp_tools` → `insert_interactive_flow_action({name:"menu_operazioni", displayName:"Menu operazioni"})`
2. Aggiunge 2 state field: `suggestions` (array non estraibile), `selectedOperationId` (string estraibile, enumFrom `suggestions`)
3. Aggiunge 2 nodi: TOOL `load_suggestions` (bindato a `platform/show_suggestions`) → USER_INPUT `pick_operation` (render DataTable su `suggestions`)
4. Set systemPrompt italiano + messageInput + locale `it`
5. `validate_patch` → `finalize`
6. Card verde "Flow pronto: ..." — canvas mostra 2 nodi

---

## ⭐⭐⭐ UC-3 — Consultazione cliente + report PDF

> **Complessità**: ★★★☆☆ (4 tool banking, ~2-3 min)
> **Tool MCP usati**: `search_customer`, `get_profile`, `list_accounts`, `generate_module`

### Setup
- Crea un flow **vuoto**
- ⌘K → scope `EMPTY_OR_NEW`

### Cosa scrivere nel Copilot

```
Devi costruire un flow interattivo di consultazione cliente per l'operatore di filiale.

Obiettivo: l'operatore cerca un cliente per cognome, sceglie il risultato corretto, il bot carica profilo anagrafico e lista rapporti attivi, assembla un report PDF riepilogativo e chiede conferma di averlo condiviso col cliente. Nessuna operazione dispositiva sul conto.

Utenti: operatori di filiale via chat in italiano, registro bancario professionale.

Dati necessari:
1. Nominativo del cliente (cognome o nome+cognome, testo libero).
2. Elenco dei clienti trovati (catalogo restituito dalla ricerca; ogni voce ha un identificativo univoco numerico di 6-10 cifre e i dati anagrafici).
3. Identificativo univoco del cliente scelto (il codice a 6-10 cifre della voce selezionata).
4. Profilo anagrafico completo (caricato dal sistema).
5. Lista rapporti attivi (caricata dal sistema).
6. Report PDF riepilogativo (generato dal servizio documenti, aggrega profilo + rapporti).
7. Conferma esplicita di avvenuta condivisione col cliente (boolean).

Passi della conversazione:
1. L'operatore indica un cognome. Il bot cerca i clienti corrispondenti.
2. Se trova uno solo, il bot memorizza l'identificativo senza chiedere. Se ne trova più, mostra una tabella con nome e identificativo e l'operatore sceglie.
3. Il bot carica in parallelo profilo e rapporti del cliente scelto.
4. Assembla il report PDF.
5. Mostra il report all'operatore e chiede esplicitamente "confermi di aver condiviso il report col cliente?".
6. Quando l'operatore conferma, il bot chiude la consultazione.

Vincoli:
- Sola consultazione: nessuna operazione che modifichi lo stato dei conti.
- Il report PDF è obbligatorio (non si chiude senza generarlo).
- La conferma esplicita è obbligatoria.
- Tutto in italiano, registro bancario professionale.

Tono: formale, cortese, asciutto. Il bot dà del "lei" all'operatore.
```

### Cosa succede

1. Discovery: `list_mcp_gateways` → `list_mcp_tools`
2. Scaffolding: `insert_interactive_flow_action({name:"consultazione_cliente", displayName:"Consultazione Cliente"})`
3. State fields (~7): `customerName`, `customerMatches`, `ndg`, `profile`, `accounts`, `reportPdf`, `confirmed`
4. System prompt italiano con esempi VALID/INVALID per `customerName`, `ndg`
5. Nodi (~6): TOOL `search_customer` → USER_INPUT `pick_customer` (DataTable) → TOOL `get_profile` → TOOL `list_accounts` → TOOL `generate_report` (bindato a `generate_module`) → CONFIRM `confirm_share` (ConfirmCard)
6. Card verde "Flow pronto: ..." — canvas mostra 6 nodi

**Prova in chat** (dopo aver pubblicato il flow e aperto `/chats/<flowId>` o usato il pulsante "Open Chat" in draft mode):

```
cerca cliente Bellafronte
```

```
scelgo NDG 11255521
```

```
sì, confermo di aver condiviso il report
```

---

## ⭐⭐⭐⭐⭐ UC-4 — Estinzione rapporto bancario completa

> **Complessità**: ★★★★★ (6 tool banking + confirm/submit, ~3-5 min)
> **Tool MCP usati**: tutti i 6 banking tool (search_customer, get_profile, list_accounts, list_closure_reasons, generate_module, submit_closure)

### Setup
- Crea un flow **vuoto**
- ⌘K → scope `EMPTY_OR_NEW`

### Cosa scrivere nel Copilot

```
Devi costruire un flow interattivo completo per la pratica di estinzione di un rapporto bancario.

Obiettivo: permettere all'operatore di filiale di avviare, compilare e inoltrare al Core Banking la richiesta di chiusura di un rapporto di un cliente, fino alla ricezione del numero di pratica. L'operatore deve concludere tutto in una singola conversazione in chat, senza aprire altri applicativi.

Utenti: operatori di filiale via chat in italiano, tono bancario professionale e cortese. L'operatore dà del "tu" ma il bot gli dà del "lei". I messaggi possono arrivare in qualsiasi ordine e possono ricapitolare dati già forniti.

Dati necessari (il bot li raccoglie in ordine logico durante la conversazione):
1. Nominativo del cliente (cognome o nome+cognome).
2. Elenco dei clienti trovati (catalogo restituito dalla ricerca; ogni voce ha identificativo univoco numerico di 6-10 cifre).
3. Identificativo univoco del cliente scelto (codice numerico 6-10 cifre; se c'è un solo match, il bot lo sceglie da solo).
4. Profilo anagrafico completo del cliente (caricato dal sistema).
5. Lista rapporti attivi del cliente (caricata dal sistema; ogni rapporto ha un identificativo nel formato XX-XXX-XXXXXXXX, es. 01-034-00392400).
6. Rapporto scelto (identificativo del formato sopra).
7. Catalogo ufficiale delle motivazioni di estinzione (caricato dal sistema; ogni voce ha un codice a 2 cifre e una descrizione, es. "01 Trasferimento estero", "02 Decesso", "03 Trasloco").
8. Motivazione scelta (il codice a 2 cifre).
9. Data di efficacia dell'estinzione (formato ISO AAAA-MM-GG, deve essere da oggi a massimo 5 anni nel futuro).
10. Modulo PDF della richiesta (generato dal servizio documenti aggregando dati cliente + rapporto + motivazione + data).
11. Conferma esplicita dell'operatore ("sì, confermo", "procedi" — un generico "ok" isolato NON basta).
12. Numero di pratica restituito dal Core Banking (formato ES-YYYY-NNN).

Passi della conversazione:
1. **Identificazione cliente**: l'operatore indica un nominativo. Il bot cerca i clienti. Se trova più risultati mostra tabella e chiede scelta, se uno solo procede, se nessuno chiede di ripetere.
2. **Profilo e rapporti**: una volta identificato il cliente, il bot carica in parallelo profilo anagrafico e lista rapporti attivi.
3. **Selezione rapporto**: il bot mostra i rapporti in tabella e chiede quale estinguere. Se l'operatore ha già indicato un identificativo valido, il bot lo usa.
4. **Motivazione**: il bot carica il catalogo motivazioni e mostra la lista. Accetta un codice 2 cifre presente nel catalogo. Se l'operatore descrive la motivazione a parole, memorizza la descrizione ma richiede selezione del codice.
5. **Data efficacia**: il bot chiede la data tramite un selettore calendario. Accetta formato italiano o ISO.
6. **Generazione modulo**: il bot assembla dati e chiama il servizio di generazione; riceve il PDF base64.
7. **Conferma**: il bot mostra il PDF in una card di conferma e chiede esplicitamente "confermi l'invio?".
8. **Invio al sistema**: alla conferma, il bot chiama il servizio di estinzione del Core Banking e comunica all'operatore il numero di pratica ricevuto.

Vincoli business:
- Il nominativo accetta lettere, spazi, apostrofi e accenti.
- L'identificativo cliente deve essere 6-10 cifre numeriche.
- L'identificativo rapporto deve rispettare esattamente il formato XX-XXX-XXXXXXXX.
- Il codice motivazione deve essere un valore presente nel catalogo.
- La data efficacia deve essere da oggi a max 5 anni nel futuro, in formato ISO AAAA-MM-GG.
- La conferma al passo 7 è obbligatoria: il bot non invia mai senza.
- Tutta l'interazione in italiano.

Tono: bancario professionale, cortese, asciutto. Niente emoji. Niente linguaggio colloquiale. Il bot non deve mai inventare dati: se un valore manca lo chiede, se un sistema non risponde lo segnala.
```

### Cosa succede

1. Discovery: `list_mcp_gateways` → `list_mcp_tools` (trova 6 banking tool)
2. Scaffolding: `insert_interactive_flow_action({name:"estinzione_rapporto", displayName:"Estinzione Rapporto"})`
3. State fields (~13): `customerName`, `customerMatches`, `ndg`, `profile`, `accounts`, `rapportoId`, `closureReasons`, `closureReasonCode`, `closureReasonText`, `closureDate`, `moduleBase64`, `confirmed`, `caseId`
4. System prompt italiano ~600 caratteri con regole VALID/INVALID per ogni field estraibile
5. Nodi (~11) in ordine topologico:
   - TOOL `search_customer` → USER_INPUT `pick_customer` (DataTable `customerMatches`)
   - TOOL `get_profile` + TOOL `list_accounts` (paralleli)
   - USER_INPUT `pick_rapporto` (DataTable `accounts`)
   - TOOL `list_reasons` → USER_INPUT `pick_reason` (DataTable `closureReasons`)
   - USER_INPUT `pick_date` (DatePickerCard)
   - TOOL `generate_module` → CONFIRM `confirm_closure` (ConfirmCard `moduleBase64`)
   - TOOL `submit_closure` → `caseId`
6. Card verde "Flow pronto: ..." — canvas mostra 11 nodi in layout layered

**Prova in chat** (dopo publish):

```
cliente Bellafronte
```

```
cliente Bellafronte NDG 11255521
```

```
cliente Bellafronte NDG 11255521 rapporto 01-034-00392400
```

```
cliente Bellafronte NDG 11255521 rapporto 01-034-00392400 motivazione 01 data 2029-04-15
```

```
cliente Bellafronte NDG 11255521 rapporto 01-034-00392400 motivazione 01 data 2029-04-15 sì confermo l'invio della pratica
```

Risposta attesa all'ultimo turno: il bot cita il `caseId` nel formato `ES-YYYY-NNN`.

---

## 🔌 Riferimento — tool MCP disponibili sul gateway `Agentic Engine Banking (local)`

| Tool | Input | Cosa fa |
|---|---|---|
| `banking-customers/search_customer` | `name` | Cerca clienti per nome |
| `banking-customers/get_profile` | `ndg` | Profilo completo da NDG |
| `banking-accounts/list_accounts` | `ndg` | Rapporti attivi del cliente |
| `banking-operations/list_closure_reasons` | — | Catalogo motivazioni estinzione |
| `banking-operations/generate_module` | `data: object` | Genera PDF modulo estinzione |
| `banking-operations/submit_closure` | `request: object` | Invia pratica al Core Banking → `caseId` |
| `platform/show_suggestions` | — | Menu flussi operativi disponibili |
| `platform/execute_rpa` | `projectPath`, `variables`, `timeoutMs`, `displayMode`, `pip` | Esegue workflow RPA locale |

Se vuoi costruire un flow che richiede un dominio diverso (apertura conto, pagamento bolletta, prestito, ecc.) va prima esteso il backend AEP — il Copilot non può inventare tool.
