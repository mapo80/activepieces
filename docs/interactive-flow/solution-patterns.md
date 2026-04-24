# Soluzioni tecniche per la conversazione — analisi concreta

> Documento per decidere **come l'LLM deve parlare col server** quando l'operatore digita un messaggio in un flow INTERACTIVE_FLOW (es. estinzione o consultazione cliente). Nessun framework, solo tecniche pure implementabili nel nostro codice TypeScript + Zod + Activepieces.

## Parte 1 — Cosa succede oggi quando l'operatore digita

Esempio concreto: siamo nel flow di estinzione, il bot ha appena chiesto il nome cliente. L'operatore digita *"Bellafronte"*.

Ecco il giro completo oggi:

1. Il messaggio `"Bellafronte"` arriva al server tramite `/v1/webhooks/:flowId/sync`
2. L'engine prende lo state corrente (`{}` al primo turno), la lista di `stateFields`, il systemPrompt del flow
3. Chiama l'API interna `/v1/engine/interactive-flow-ai/field-extract` che a sua volta chiama l'LLM
4. **L'LLM riceve un prompt monolitico** tipo *"Estrai i campi qui elencati dal messaggio…"*. Ha accesso a tutto lo state, a tutti i 13 stateField, alla history.
5. **L'LLM produce un JSON unico**: `{ "extractedFields": { "customerName": "Bellafronte" }, "evidence": "Bellafronte", "turnAffirmed": false }`
6. Il server parsa questo JSON e applica i filtri:
   - evidence-check (la parola "Bellafronte" è dentro il messaggio? sì)
   - admissibility (customerName è extractable? sì, ha scope global)
   - plausibility (matcha la regex `^[A-Za-zÀ-ÿ' -]+$`? sì)
   - domain (c'è un enumFrom? no per customerName)
7. `flowState.customerName = "Bellafronte"`
8. Il flow avanza a `search_customer` (nodo TOOL), MCP viene chiamato, carica `customerMatches`
9. Pausa al nodo successivo `pick_ndg`, bubble al client, fine turno

**In una frase**: il server dice al LLM *"ecco il messaggio, dimmi cosa hai capito in un JSON"*, riceve un JSON, lo filtra, aggiorna lo state.

Questo approccio funziona, ma ha alcuni limiti che vedremo nella Parte 3.

---

## Parte 2 — I modi possibili per far parlare LLM e server

Ci sono 5 modi tecnici concreti. Li racconto con un esempio reale per ciascuno.

### Modo 1 — "Dimmi tutto in un JSON" (è quello che facciamo oggi)

Il server manda un prompt al LLM e si aspetta **un JSON strutturato** con i valori estratti. Il JSON ha la stessa forma per tutti i turni.

```
User: "Bellafronte"
LLM → Server: {
  "extractedFields": { "customerName": "Bellafronte" },
  "evidence": "Bellafronte",
  "turnAffirmed": false
}
```

Quando funziona bene: estrazioni semplici di 1-4 campi, dove l'LLM deve solo riconoscere valori nel testo.

Quando inizia a non bastare: quando l'utente **non vuole estrarre** (es. chiede "quanti rapporti?", chiede di annullare, dice "scusa mi correggo"). In questi casi il JSON diventa goffo: dobbiamo aggiungere campi come `userIntent`, `metaAnswer`, `cancel` e il server finisce per fare un grande `if/else` sull'output.

### Modo 2 — "Dimmi che cosa vuole fare l'utente" (intent classification)

Il server chiede al LLM: *"In questo turno, cosa vuole fare l'utente? Scegli tra: estrarre un valore, fare una domanda, annullare, confermare, rifiutare, chiedere di ripetere."*

```
User: "quanti rapporti ha?"
LLM → Server: {
  "userIntent": {
    "type": "info-question",
    "answer": "Ne ha 17 attivi"
  }
}
```

Il server ha un `switch` con un ramo per ogni tipo di intent. Ogni ramo sa cosa fare: `extract` applica i valori, `info-question` emette la risposta senza avanzare il flow, `cancel` avvia una conferma di annullamento, ecc.

**Limite grosso**: l'utente può fare **una cosa sola per turno**. Se scrive *"Rossi, quanti rapporti?"* l'LLM deve scegliere — o applica il nome e perde la domanda, o risponde alla domanda e perde il nome. Non c'è via di mezzo.

### Modo 3 — "Qui ci sono degli strumenti, chiama quello che ti serve" (tool calling)

Il server dice al LLM: *"Hai 7 strumenti a disposizione. Per questo turno, chiama quelli che servono."* Ogni strumento ha un nome, un contratto (parametri con schema) e un effetto lato server.

Gli strumenti che servirebbero a noi:

- `setStateField(field, value, evidence)` → applica un valore
- `respondInfo(text, citedFields)` → risponde a una domanda sui dati
- `respondMeta(text)` → risponde a "cosa avevi chiesto" / "ripeti"
- `requestOverwrite(field, oldValue, newValue)` → chiede conferma per sovrascrivere
- `requestCancel(reason)` → chiede conferma per annullare il flow
- `acknowledgePending(decision)` → risposta sì/no a una domanda pendente del bot
- `continueFlow()` → ok generico, avanza

Esempio su compound intent:

```
User: "Bellafronte, quanti rapporti ha?"
LLM → Server: [
  { tool: "setStateField", args: { field: "customerName", value: "Bellafronte", evidence: "Bellafronte" } },
  { tool: "respondInfo", args: { text: "Devo prima caricare i dati di Bellafronte", citedFields: [] } }
]
```

Il server cicla sulle chiamate ed esegue i rispettivi handler. L'utente ha ottenuto **entrambe le cose** nello stesso turno senza che dovesse ripetersi.

Questo è lo standard industriale moderno (OpenAI function calling, Anthropic tool use). Il nostro provider già lo supporta nativamente.

### Modo 4 — "Dimmi cosa vuoi fare con un mini-linguaggio testuale"

Variante del Modo 3 senza usare il tool-calling nativo del provider: il LLM scrive una stringa strutturata che il server parsa con una grammar dichiarata.

```
User: "Bellafronte, quanti rapporti ha?"
LLM → Server (come testo):
  set_slot customerName="Bellafronte" evidence="Bellafronte"
  respond_info "Devo prima caricare Bellafronte" cite=none
```

Funziona ma oggi non ha senso farlo: i provider che usiamo (Claude, OpenAI-compatible) hanno già il tool-calling nativo, che fa la stessa cosa in modo più robusto, senza dover scrivere e manutenere un parser.

### Modo 5 — "Istruzioni diverse per ogni nodo del flow"

Variante orizzontale dei modi precedenti: invece di dare al LLM un prompt generale che copre tutto il flow, **ogni nodo ha il suo mini-prompt** con solo le istruzioni rilevanti per quello step.

Esempio: quando siamo al nodo `pick_ndg`, il prompt dice *"Stai aspettando la selezione di un NDG dalla lista customerMatches. Accetta solo valori presenti nella lista."*. Quando siamo al nodo `collect_date`, il prompt dice *"Stai aspettando una data ISO futura, non oltre 5 anni."*.

Questo si combina con Modo 2 o Modo 3 (non li sostituisce). Un paper del 2025 ha misurato che questa tecnica da sola porta **+52% di accuratezza** rispetto al prompt generico.

### Tabella comparativa dei 5 modi

Per un colpo d'occhio rapido, ecco come i 5 modi si confrontano sugli assi che contano per noi:

| Aspetto | Modo 1 — JSON monolitico (oggi) | Modo 2 — Intent | Modo 3 — Tool-calling | Modo 4 — DSL testuale | Modo 5 — Prompt per nodo |
|---|---|---|---|---|---|
| **Cosa produce l'LLM** | Un unico JSON `{extractedFields, evidence, turnAffirmed}` | Un JSON con `intent.type` + payload | Lista di 1-N tool call con schema Zod | Stringa strutturata da parsare | Uguale a Modo 2 o 3 (è orizzontale) |
| **Esempio output su "Bellafronte"** | `{extractedFields: {customerName: "Bellafronte"}}` | `{intent: {type: "extract", fields: {customerName: "Bellafronte"}}}` | `[setStateField({field: "customerName", value: "Bellafronte"})]` | `set_slot customerName="Bellafronte"` | Combinato con 2 o 3 |
| **Una cosa o più cose in un turno** | Una (più campi ma 1 azione implicita) | Una sola (scegli tra N intent) | **Più cose** (compound nativo) | Più cose | Dipende dal modo base |
| **Risolve "cancel flow"** | No | Sì | Sì | Sì | Dipende |
| **Risolve "meta-question"** (*cosa avevi chiesto?*) | No | Sì | Sì | Sì | Dipende |
| **Risolve "info-question"** (*quanti rapporti?*) | No | Sì | Sì | Sì | Dipende |
| **Risolve compound** (*Rossi, quanti rapporti?*) | No | **No** | **Sì** | Sì | Dipende |
| **Provider support** | Qualunque LLM | Qualunque LLM | Claude, OpenAI, Gemini (nativo) | Qualunque LLM | Qualunque LLM |
| **Prompt engineering** | Basso (generico estrazione) | Medio (descrivere N intent) | Medio-alto (descrivere N tool) | Medio-alto (DSL + grammar) | Alto (N prompt, uno per nodo) |
| **Robustezza output** (no parse error) | Media (JSON può essere malformato) | Media | Alta (schema strict enforced) | Bassa (parser custom) | Dipende |
| **Validation server side riusata** | Sì (candidatePolicy, enum, evidence) | Sì | Sì | Sì | Sì |
| **Test e2e deterministici** | Sì | Sì | Sì | Sì | Sì |
| **Log leggibilità** | `extractedFields: {...}` | `intent.type: extract` | `tool_call(name, args)` per ciascuna | Testo parsato | Uguale al modo base |
| **Aggiungere una nuova capacità** | Aggiungere campo al JSON + nuovo `if` | Aggiungere variant + handler | **Aggiungere 1 tool** (più isolato) | Aggiungere regola alla grammar | Aggiungere prompt al nodo + (modo base) |
| **Accuracy slot filling** (benchmark paper) | Baseline | Equivalente baseline | Equivalente baseline | Equivalente baseline | **+52% baseline** |
| **Latenza LLM call per turno** | 1 | 1 | 1 | 1 | 1 |
| **LoC per implementare from scratch** | Già fatto | ~1500 | ~1800 | ~1800 | +300 rispetto al modo base |
| **Da evitare?** | Limite concreto in produzione | Ok se compound non serve mai | No, è il pattern consigliato | Sì: parser da manutenere inutilmente | No, è un add-on utile |
| **Adatto banking / compliance** | Medio | Alto | Alto | Medio | Alto |

**Lettura sintetica della tabella**:

- Modo 1 (oggi) è il riferimento — funziona ma non copre 4 dei 6 gap
- Modo 2 è "il Modo 1 pulito" ma non copre compound
- Modo 3 è l'unico che copre tutto ed è oggi lo standard industriale
- Modo 4 esiste solo se non hai tool-calling nativo — noi ce l'abbiamo, quindi salta
- Modo 5 non è alternativo: è un booster applicabile sopra al Modo 2 o al Modo 3, ed è quello con il guadagno misurato più alto in accuracy (+52% sul benchmark)

---

## Parte 3 — Cosa il sistema attuale non copre

Con il Modo 1 in produzione, questi sono i comportamenti che oggi non funzionano o funzionano male:

**Gap 1 — Annullamento flow**

L'operatore dice *"annulla"* a metà flow. Oggi la parola è nella blocklist, quindi non viene estratta come valore, ma il sistema cade nel fallback generico *"Per procedere, può indicarmi…"*. Non c'è un vero meccanismo di cancel con conferma (*"Sei sicuro? Perderai i dati inseriti"*).

**Gap 2 — Domande meta dell'operatore**

*"Cosa mi avevi chiesto?"*, *"ripetimi"*, *"non ho capito"*. L'LLM oggi produce un campo `metaAnswer` opzionale, ma il server **lo ignora** — non viene mai restituito all'utente come bubble. Il bot cade sempre sul template *"Per procedere, può indicarmi…"*.

**Gap 3 — Domande informative sui dati caricati**

*"Quanti rapporti ha il cliente?"*, *"di che tipo è il primo?"*. L'informazione è nello state (`accounts` caricato da MCP), ma non c'è modo di risponderla senza far deragliare il flow.

**Gap 4 — Compound intent**

*"Bellafronte, quanti rapporti ha?"* — due cose in un turno. Il Modo 1 e il Modo 2 forzano a sceglierne una, perdendo l'altra. Solo il Modo 3 lo copre nativamente.

**Gap 5 — Topic change che pulisce anche i nodi eseguiti**

Quando l'operatore cambia idea (*"scusa era Rossi"*), il server oggi pulisce i **valori** a valle ma lascia marcati come "eseguiti" i nodi TOOL a monte. Piccolo rumore nei log e nella timeline chain-of-thought, niente di drammatico.

**Gap 6 — Nessun limite alle domande meta consecutive**

Se l'operatore fa 5 domande meta di fila, il bot risponde sempre — non esiste un meccanismo che dopo N domande riporti l'operatore al task.

---

## Parte 4 — Quale modo copre quali gap

Rileggendo Gap 1-6 in chiave "quale dei 5 modi li risolve":

| Gap | Modo 1 (oggi) | Modo 2 (intent) | Modo 3 (tool-calling) | Modo 5 (prompt per nodo) |
|---|:---:|:---:|:---:|:---:|
| Gap 1 — Cancel con conferma | ❌ | ✅ | ✅ | ✅ |
| Gap 2 — Meta-question | ❌ | ✅ | ✅ | ✅ |
| Gap 3 — Info-question | ❌ | ✅ | ✅ | ✅ |
| Gap 4 — **Compound intent** | ❌ | ❌ | ✅ | ✅ |
| Gap 5 — Clean executedNodeIds al topic change | ✅ | ✅ | ✅ | ✅ |
| Gap 6 — Loop prevention meta | ✅ | ✅ | ✅ | ✅ |

Gap 5 e Gap 6 sono problemi di implementazione server-side, indipendenti dal "modo" LLM. Si risolvono in qualsiasi modo (poche righe di codice).

Gap 1, 2, 3 si risolvono con **qualunque** Modo ≥ 2. Serve solo che l'LLM possa comunicare "oggi non sto estraendo un valore, sto facendo altro" in modo strutturato.

**Gap 4 è il discriminante**. Solo il Modo 3 (tool-calling) lo risolve nativamente, perché è l'unico dove l'LLM può fare più di una cosa in un turno.

---

## Parte 5 — Trade-off operativi dei 3 modi in gioco

Escludo Modo 4 (parser DSL da manutenere, meglio tool-calling nativo) e Modo 1 (è quello che abbiamo oggi, non lo evolvo).

### Modo 2 (Intent System)

**Pro**:
- Semplice da implementare: definisci 7 "intent", scrivi 7 handler, esci
- Prompt al LLM è corto ("scegli tra questi 7")
- Comportamento deterministico (1 intent → 1 handler)
- Test e2e stabili, asserzione su `intent.type`

**Contro**:
- Gap 4 non risolto: compound lost
- Aggiungere un intent in futuro = cambiare schema + handler, più lavoro

**Quando sceglierlo**: se i flow sono quasi sempre lineari e il compound non serve mai.

### Modo 3 (Tool-calling Agent)

**Pro**:
- Gap 4 risolto nativamente
- Log leggibilissimi: `tool_call(setStateField, {field: customerName, value: Bellafronte})`
- Aggiungere una capacità = + 1 strumento (1 file nuovo)
- Standard industriale 2025 per agentic workflow

**Contro**:
- Prompt engineering più accurato: devi spiegare al LLM quando usare quale strumento
- L'LLM potrebbe sbagliare a chiamare uno strumento: serve validation lato server (che abbiamo già: candidatePolicy, enum check, evidence check si riusano tutti)

**Quando sceglierlo**: se vuoi gestire compound oggi, o prevedi flow consultativi dove sono frequenti.

### Modo 3 + Modo 5 (Tool-calling con prompt per nodo)

**Pro**: tutti quelli del Modo 3, più +52% accuratezza su slot filling (paper 2025).

**Contro**: serve definire un mini-prompt per ogni nodo del flow (es. 11 prompt per estinzione). Non sono testi lunghi, ma li devi scrivere.

**Quando sceglierlo**: se accuracy è critica. Compliance banking rientra qui.

---

## Parte 6 — La mia proposta concreta per i nostri 2 flow

### Sul versante "come parla l'LLM"

Passare al **Modo 3 (tool-calling)** con questi 7 strumenti:

1. `setStateField` — applica un valore extractable
2. `respondInfo` — risponde a una domanda sui dati in state
3. `respondMeta` — risponde a meta-question ("cosa avevi chiesto?")
4. `requestOverwrite` — chiede conferma per correggere un valore già estratto
5. `requestCancel` — chiede conferma per annullare il flow
6. `acknowledgePending` — risposta sì/no a una domanda pendente del bot
7. `continueFlow` — ok generico

Motivo tecnico: è l'unico che risolve Gap 4 (compound intent) senza aggiungere complessità rispetto al Modo 2. La differenza di costo implementativo fra Modo 2 e Modo 3 è circa 300-400 LoC — trascurabile.

### Sul versante "qualità del prompt"

Associare a ciascun nodo del flow **un mini-prompt contestuale** (Modo 5). Esempio:

- Nodo `pick_ndg`: *"Stai aspettando un NDG presente nella lista customerMatches. Se l'operatore dice un numero, verifica che sia nella lista. Se chiede informazioni sulla lista, usa respondInfo."*
- Nodo `confirm_closure`: *"Stai aspettando la conferma finale dell'invio della pratica. Accetta come conferma solo affermazioni esplicite. Ogni altra cosa chiedi di nuovo."*

Il mini-prompt è un campo `nodePrompt?: string` nel fixture del flow (accanto a `displayName`, `message.systemPromptAddendum` che già abbiamo). Se non specificato, cade sul systemPrompt globale.

### Sul versante "server side"

Aggiungere i 3 gap mancanti:

- Gap 5: durante l'invalidazione al topic change, rimuovere anche `executedNodeIds` e `skippedNodeIds` per i nodi a valle. ~20 LoC.
- Gap 6: counter `consecutiveMetaCount` nella session. Al 3°, il server aggiunge al prossimo messaggio del bot il re-prompt del campo mancante. ~30 LoC.
- Cancel: introduzione del pending type `pending_cancel` (oggi abbiamo `confirm_binary`, `pick_from_list`, `pending_overwrite` — aggiungiamo il 4° tipo). ~50 LoC.

### Stima complessiva

| Voce | LoC |
|---|---|
| Tool-calling agent: 7 strumenti, handler registry, validation riusata | ~1200 |
| Mini-prompt per nodo: schema + 11 prompt estinzione + 6 consultazione | ~300 |
| Gap 5, 6 e cancel | ~100 |
| Test unit (policy invariate, nuovi handler) | ~500 |
| Test e2e parametrizzato sui 2 flow | ~400 |
| **Totale** | **~2500** |

---

## Parte 7 — Cosa scarto e perché

- **Modo 4 (parser DSL custom)**: avremmo da manutenere una grammar. Il tool-calling nativo del provider fa la stessa cosa meglio, senza parser.
- **Evaluator-optimizer loop** (LLM che valuta un altro LLM): raddoppia latenza e costo, porta poco per DAG strutturati come i nostri. Utile solo per task aperti (open-ended generation).
- **Programmatic tool calling** (LLM che scrive codice eseguito in sandbox): overkill, complessità operativa alta, audit trail difficile in banking.
- **ReAct puro** (loop Thought-Action-Observation auto-iterante): non-deterministico, test fragili, incompatibile con i requisiti di compliance banking.

---

## Parte 8 — Riepilogo decisionale in 3 righe

- Il nostro **Modo 1** attuale copre estrazione ma lascia aperti 4 gap (cancel, meta, info, compound).
- Il **Modo 2** sistemerebbe 3 gap su 4 (non copre compound). Semplice ma short-sighted.
- Il **Modo 3** sistema tutti i gap, più +52% accuracy se combinato con prompt per-nodo (Modo 5). Costa ~2500 LoC e 1-2 settimane di prompt engineering. È lo standard moderno del settore.

Voto: **Modo 3 + Modo 5**. Se vuoi andare piano, è possibile fare prima **Modo 3 puro** (senza prompt per-nodo), con l'intenzione di aggiungere Modo 5 in una seconda iterazione.

## Fonti

- [Practical Approach for Building Production-Grade Conversational Agents with Workflow Graphs (arxiv 2505.23006)](https://arxiv.org/html/2505.23006v1) — +52% accuracy con prompt per-nodo
- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) — pattern tool-calling per workflow multi-turno
- [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — strict mode e JSON schema
