# Review critica finale — soluzione per la conversazione INTERACTIVE_FLOW

> Questo documento prende la proposta che ho fatto in [solution-patterns.md](./solution-patterns.md) (Modo 3 + Modo 5: tool-calling agent con prompt per-nodo), la sottopone a una **critica rigorosa** usando dati di produzione 2026, identifica i punti deboli e propone la versione definitiva con safeguard e rappresentazione del DAG invariata.

## 1. La proposta in esame

Promemoria: stiamo valutando di passare da *"LLM produce un JSON monolitico con i campi estratti"* (sistema attuale) a *"LLM emette 1-N tool call strutturate per turno + ogni nodo del DAG ha il proprio mini-prompt"*.

Il DAG del flow — **quello che vedi oggi nel builder canvas** — resta identico. Cambia solo l'interfaccia tra messaggio utente e aggiornamento di stato.

## 2. I numeri spietati del 2026 in produzione

Prima di entrare nel merito, ancorismoci ai dati misurati.

Dalla ricerca 2026:

- **Compound failure**: un workflow a 5 passi con 85% di accuracy per-passo scende al 44% di success rate complessivo. A 10 passi scende al 20%.
- **Context retention**: degrada del 2% per step. Dopo 10 turni di conversazione, l'LLM richiama correttamente l'80% del contesto iniziale.
- **Parameter fabrication**: è il failure mode più comune del tool calling. L'LLM genera valori plausibili ma non presenti nel messaggio utente.
- **Schema drift**: nel 2026 è documentato un caso (n8n v2.4.7 → v2.6.3) in cui un upgrade del provider LLM ha rotto gli schemi tool — silent failure, solo assert a runtime.
- **Bounded scope**: gli agent di successo hanno *"un dominio ben definito e rifiutano esplicitamente task fuori dallo scope"*. Quelli monolitici (troppi tool in scope) falliscono silenziosamente.
- **Hallucination**: LLM cade nell'uso di pre-training knowledge al posto di recuperare metadata dal catalog attuale. È il caso più pericoloso in banking (valori plausibili ma sbagliati).

Questi numeri devono guidare ogni scelta architetturale.

## 3. Review critica della proposta

Passo ciascun punto della proposta al setaccio.

### Critica #1 — Compound intent non è sempre un guadagno netto

**Claim nella proposta**: *"il Modo 3 gestisce compound nativamente → eccellente UX"*.

**Critica**: il compound introduce **compound failure**. Se un turno ha 2 tool call e ciascuna ha 95% di accuracy indipendente, il turno intero è accurato al 0.95 × 0.95 = **90.25%**. Su 6 turni di flow estinzione (tipico): 0.9025⁶ = **54% di success rate** per flow completi.

**Questo è peggio** del Modo 1 attuale, in cui ogni turno è 1 sola operazione (extract) con 95% accuracy: 0.95⁶ = **74%**.

**Risposta**: il numero di tool call per turno deve essere **artificialmente limitato**. Turni semplici → 1 tool call. Compound → 2 massimo. Triplice compound in un turno → reject (improbabile in pratica, ma policy esplicita).

**Mitigation implementabile**: max 2 tool call per turno nel validation layer; se l'LLM ne emette 3+, il server rigetta la chiamata extra e chiede riformulazione. Alternativa: **continuare a fare 1-call turni normali** e abilitare 2-call SOLO quando il messaggio passa un pre-filtro (contiene "e", "poi", "intanto" o domanda in aggiunta a valore). Pre-filtro lightweight (regex, no LLM call).

### Critica #2 — Parameter fabrication è il rischio n.1 del tool-calling

**Claim nella proposta**: *"evidence come parametro obbligatorio → hallucination mitigato a schema level"*.

**Critica**: il paper 2505.23006 e la survey sulla hallucination 2026 mostrano che *"evidence forced"* è un mitigation **parziale**. L'LLM può:

- Inventare un valore plausibile (es. `ndg: "11255521"`) e passare come evidence *"11255521"* copiato dal messaggio del bot precedente, non da quello user.
- Alterare una cifra di un valore reale (es. user dice `"11255521"`, LLM emette `ndg: "11255522"` con evidence `"11255521"`) — la nostra `verifyEvidence` matcha perché cerca substring.
- Confondere due valori (user dice `rapportoId: "01-034-00392400"`, LLM lo mappa a ndg).

**Risposta**: servono layer multipli di validation, non solo evidence.

**Mitigation da aggiungere**:

1. **Evidence exact-match su user message**: la substring di evidence deve essere SOLO nel messaggio utente del turno corrente (NON in history, NON in bot message). Già abbiamo `normalization.locateEvidence` parziale — va esteso per escludere bot messages.
2. **Type-consistent value**: evidence contiene `"11255521"`, value estratto deve essere `"11255521"` (non `"11255522"`). Check: `value contenuto in evidence` (no modification).
3. **Domain check contro catalog** (già esistente ma da rinforzare): valore deve essere in state enumFrom ESATTAMENTE (no typo tolerance).
4. **Confidence threshold**: se l'LLM supporta confidence scoring (OpenAI `logprobs`, Claude API risposte), tool call con confidence < 0.7 → richiedere conferma invece di applicare.

### Critica #3 — Prompt per-nodo aumenta la superficie di manutenzione

**Claim**: *"prompt per-nodo → +52% accuracy (paper benchmark)"*.

**Critica**: 
- Estinzione ha 11 nodi. Consultazione ne avrà 6. Altri flow futuri: altri prompt.
- Ogni prompt è 100-300 token di istruzioni specifiche. Se cambio la policy generale (es. "non mai estrarre confirmed al turno 1"), devo toccare 17+ prompt.
- Rischio di divergenza: un prompt è più permissivo, un altro più restrittivo → comportamento incoerente percepito dall'utente.

**Risposta**: il +52% è reale ma dipende da come sono scritti i prompt, non automatico.

**Mitigation**:
1. **Prompt come composizione**: `nodePrompt = globalGuardrails + nodeSpecific`. Il globale (policy di sicurezza) vive in un solo posto, il nodeSpecific è 2-3 righe.
2. **Test suite per prompt**: 20 turni annotati per ogni flow (input → expected tool call). Regressione se accuracy < 90%. Misuriamo, non ipotizziamo.
3. **Audit periodico**: il paper nota che la divergenza è un bug silente. Quindi serve un automated job che esegue il test suite a ogni merge.

### Critica #4 — Schema drift dei provider LLM è un rischio documentato

**Claim**: *"il tool-calling è standard industriale"*.

**Critica**: lo è, ma gli schemi cambiano. Tra Claude 4 e Claude 4.5 ci sono state modifiche (parametri in più opzionali, comportamento default di `tool_choice`). Se non abbiamo test di integrazione automatici contro LLM reale, un upgrade provider può rompere il sistema silenziosamente.

**Mitigation**:
1. **Integration test giornaliero** (o a release) contro LLM reale, con 10-20 turni tipici. Si esegue in CI dedicata, non blocca le PR normali.
2. **Provider version pinning**: `claude-4-5-20250929` anziché `claude-4-latest`. Upgrade esplicito, con test prima.
3. **Fallback graceful**: se lo schema di output non è parseable (zod fail), il sistema deve degradare al fallback insufficient-info, non crashare.

### Critica #5 — Observability da costruire before-production

**Claim**: *"log strutturati → debug facile"*.

**Critica**: per davvero serve un **tracing strutturato** per ogni turno. Oggi abbiamo il debug JSONL (`AP_IF_DEBUG_LOG`), che è buono ma non è trace. La ricerca 2026 mostra che le piattaforme di observability (Langfuse e simili) sono diventate lo standard per LLM in produzione.

**Mitigation**:
1. **Session trace JSON**: ogni turno emette un record strutturato con `{turnId, userMessage, systemPrompt, toolCallsEmitted, validationResults, stateChange, latencyMs, tokens, provider, model, flowId, nodeId}`. Facile da analizzare con SQL/jq.
2. **Replay tool**: `npm run replay -- <turnId>` ricostruisce input + output dal trace, permette di testare fix offline.
3. **Dashboard di drift**: grafici %tool-call emesse per tipo, %validation failed, %evidence mismatch. Dashboard = alerting.

Costo: ~150 LoC + un file SQL/ndjson ricevitore. Non servono tool esterni.

### Critica #6 — La rappresentazione del flow deve restare chiara

**Vincolo esplicito dell'utente**: *"mi piacerebbe avere una rappresentazione del flow come ce l'abbiamo adesso"*.

**Critica**: nella proposta, il tool-calling agent può essere percepito come "invisibile" — l'operatore vede solo la bubble finale, non capisce cosa l'LLM ha deciso. Questo è in tensione con il chain-of-thought che abbiamo già implementato.

**Mitigation — ed è la chiave del redesign**:
Ogni tool call emessa dall'LLM diventa un **evento sul chain-of-thought** esistente. Il nostro `RuntimeTimeline` (già implementato) mostra per ogni nodo: `⏳ Started → ✓ Completed → ⏸ Paused`. Estendiamo con:

- `💬 Meta response` quando `respondMeta` emesso
- `ℹ️ Info response` quando `respondInfo` emesso
- `🔄 Topic change` quando `setStateField` aggiorna un field già popolato
- `⚠️ Overwrite pending` quando `requestOverwrite` emesso
- `🛑 Cancel requested` quando `requestCancel` emesso
- `✅ Cancel confirmed` quando pending_cancel accettato
- `↩️ Overwrite confirmed` quando pending_overwrite accettato

**Il DAG del flow resta IDENTICO**. La timeline chain-of-thought si arricchisce. L'operatore vede esattamente ogni azione che il sistema fa.

Nel canvas del builder, nessun cambio: continuiamo a vedere i nodi del DAG con i badge di stato (STARTED/COMPLETED/...). Le azioni conversazionali del tool-calling non diventano "nodi" del DAG — sarebbero rumore — ma eventi annotati nel chain-of-thought chat-side.

### Critica #7 — Costo nascosto delle tool call strict + logprobs

**Claim**: *"costo LLM invariato"*.

**Critica**: il tool-calling con strict mode (Claude, OpenAI) richiede un payload più grande (definizioni tool, schema Zod). Valuto costi reali:

- System prompt attuale: ~1000 token
- Con definizioni tool (7 tool × ~80 token/tool): +560 token
- Con node-specific prompt: +200 token medio
- **Totale system**: ~1760 token per turno

A Claude Sonnet 4.5 ($3/1M input): **$0.0053 per turno di input**. Rispetto a $0.003 attuale (+80%). Accettabile, ma non "invariato".

Mitigation: 
1. **Tool definitions via provider cache**: Anthropic supporta caching del system prompt (cache 5 min). Riduciamo da $0.0053 a $0.0015 per turno dopo il primo.
2. **Node-specific prompt solo quando il nodo cambia**: se l'utente fa 3 turni sullo stesso nodo, non serve rispedire il node-prompt 3 volte.

### Critica #8 — La proposta non include metriche di successo quantitative

**Critica**: ho descritto la soluzione senza definire *cosa sia "meglio"*. Impossibile valutare l'implementazione.

**Mitigation**: definire 5 metriche con target numerici.

| Metrica | Target | Come si misura |
|---|---|---|
| Turn accuracy | ≥ 95% (vs 90% attuale, stima) | Test suite 20 turni × 2 flow, LLM as judge o annotation manuale |
| Flow completion rate | ≥ 80% | % di sessioni che raggiungono il terminale con caseId / sharedConfirmed |
| Tool call validation failure rate | ≤ 2% | Tool call emesse / tool call rejected dal validation layer |
| Parameter fabrication rate | ≤ 0.5% | Evidence mismatch / total setStateField calls |
| p95 latency per turno | ≤ 3s | End-to-end (user message sent → bot message received) |

Monitoraggio in staging per 1 settimana, production solo se tutte ≥ target.

## 4. Soluzione definitiva con safeguard

Cristallizzo ciò che emerge dalla review. La soluzione è **Modo 3 + Modo 5** con 6 safeguard tecnici non opzionali:

1. **Max 2 tool call per turno** (limit nel validation layer)
2. **Evidence exact-match su user message corrente** (escluso bot message e history)
3. **Bounded tool scope per-nodo**: ogni nodo espone solo i tool che ha senso usare in quel contesto (es. al nodo `pick_ndg`, `setStateField` accetta solo `field='ndg'`)
4. **Integration test LLM reale** daily + version pinning provider
5. **Session trace JSONL + replay tool + dashboard drift**
6. **Chain-of-thought esteso con 7 nuovi kind** (META_RESPONSE, INFO_RESPONSE, TOPIC_CHANGED, OVERWRITE_PENDING, OVERWRITE_CONFIRMED, CANCEL_REQUESTED, CANCEL_CONFIRMED)

Inoltre, mantenere questi invarianti del sistema attuale:

- DAG del flow immutato
- Builder canvas invariato (gli operatori continuano a vedere gli stessi nodi)
- Fixture `estinzione.json` compatibile (zero breaking)
- Policy layer (candidatePolicy, enum, overwrite) riusate al 100%

## 5. Come appare il flusso di un turno (rappresentazione visiva)

Il DAG del flow **non cambia**. Cambia solo il pezzo di plumbing fra messaggio utente e aggiornamento state. Ecco prima/dopo su un turno concreto.

### Turno: *"Bellafronte, quanti rapporti ha?"* (compound)

**Prima (Modo 1, oggi)**:

```
User message: "Bellafronte, quanti rapporti ha?"
        │
        ▼
┌─────────────────────────────────────┐
│ LLM (1 call, JSON monolitico)       │
│ • Vede systemPrompt generale        │
│ • Vede tutti i 13 stateField        │
│ • Restituisce: {                    │
│     extractedFields: {              │
│       customerName: "Bellafronte"   │
│     }                               │
│   }                                 │
│ → la domanda "quanti?" viene persa  │
└─────────────────────────────────────┘
        │
        ▼
Server: applica customerName
        │
        ▼
DAG avanza a search_customer
```

**Dopo (Modo 3 + Modo 5, proposta)**:

```
User message: "Bellafronte, quanti rapporti ha?"
        │
        ▼
┌────────────────────────────────────────────────┐
│ LLM (1 call, tool-calling con schema strict)   │
│ • Vede systemPrompt globale                    │
│ • Vede nodePrompt di "search_customer"         │
│   (tool disponibili: setStateField.customerName│
│    + respondInfo + respondMeta + requestCancel)│
│ • Restituisce:                                 │
│   [                                            │
│     setStateField(                             │
│       field="customerName",                    │
│       value="Bellafronte",                     │
│       evidence="Bellafronte"                   │
│     ),                                         │
│     respondInfo(                               │
│       text="Carico i dati di Bellafronte,     │
│              poi le mostro i rapporti",        │
│       citedFields=[]                           │
│     )                                          │
│   ]                                            │
└────────────────────────────────────────────────┘
        │
        ▼
Validation layer:
  ✓ max 2 tool call (ok)
  ✓ evidence match user message (ok)
  ✓ admissibility customerName (ok, global scope)
  ✓ bounded scope del nodo (setStateField.customerName permesso)
        │
        ▼
Executor cicla sulle tool call:
  1) setStateField → flowState.customerName = "Bellafronte"
     (topic-change? no, primo valore)
  2) respondInfo → bubble emessa
        │
        ▼
DAG avanza a search_customer (MCP call)
        │
        ▼
Chain-of-thought timeline (visibile all'operatore):
  ⏳ Cerca cliente
  💬 "Carico Bellafronte, poi le mostro i rapporti"
  ✓ Cerca cliente
  ⏸ Seleziona NDG
```

### Turno: *"annulla"* (cancel)

```
User: "annulla"
        │
        ▼
LLM → [ requestCancel(reason="utente richiesto") ]
        │
        ▼
Validation: ok
        │
        ▼
Handler: emette pending_cancel + bubble "Sei sicuro? Perderai i dati inseriti"
        │
        ▼
Chain-of-thought:
  ⚠️ Cancel richiesto
  (bot attende affirm/deny)
```

Turno successivo user clicca "Sì":

```
User: (click "Sì annulla")
        │
        ▼
LLM → [ acknowledgePending(decision="accept") ]
        │
        ▼
Handler legge pendingInteraction.type == 'pending_cancel'
       → soft-reset state
       → emit CANCEL_CONFIRMED
       → flow riparte da search_customer
        │
        ▼
Chain-of-thought:
  ⚠️ Cancel richiesto
  🛑 Cancel confermato
  (flow ripartito)
```

### DAG nel canvas del builder: invariato

```
┌─────────────────┐
│ search_customer │ ◄── nessun cambio
│   (TOOL)        │
└────────┬────────┘
         │
┌────────▼────────┐
│   pick_ndg      │ ◄── nessun cambio
│ (USER_INPUT)    │
└────────┬────────┘
         │
   ... etc identico
```

Gli operatori continuano a vedere esattamente il flow che vedono oggi. L'unica novità visibile è l'arricchimento del chain-of-thought chat-side.

## 6. Cosa scarto esplicitamente (perché non superano la review)

- **Evaluator loop** (LLM che valuta un altro LLM): raddoppia latenza/costo. La review #7 mostra che tool-calling + cache ha costo accettabile senza bisogno di un 2° LLM per turno.
- **ReAct puro**: non deterministico. La review #1 mostra che il compound failure su 10 step (20% success) è incompatibile con banking.
- **Programmatic tool calling**: sandbox per eseguire codice LLM-generated è overhead operativo non giustificato per un DAG rigido.
- **DAG dinamico generato dall'LLM**: la ricerca Prompt2DAG mostra che generazione automatica di DAG arriva al 78% di success rate — inadeguato per banking.
- **Multi-agent orchestrator**: non abbiamo sotto-agenti autonomi. Scope monolitico perfettamente adatto a DAG strutturato.

## 7. Piano di rollout senza rischi

1. **Shadow mode 2 settimane**: il tool-calling agent esegue in parallelo al sistema attuale. Log confronto. Zero user-facing change.
2. **Canary 10% flow estinzione in staging**: flag `AP_CONVERSATION_AGENT=true` per un subset. Monitor metriche §3.8.
3. **Full estinzione in staging**: 1 settimana di monitoring continuo.
4. **Production estinzione**: rollout con feature flag per-platform. Possibilità di rollback istantaneo.
5. **Consultazione cliente**: nuovo flow introdotto già con tool-calling agent (no migration).
6. **Flow futuri**: default tool-calling agent.

Rollback plan: il vecchio path Modo 1 resta nel codice (feature-flag gated) per 1 quarter. Se osserviamo regressione > 5% sulle metriche, rollback in 10 secondi (flag off).

## 8. Stima finale corretta (post-review)

| Voce | LoC base | LoC safeguard (review) | Totale |
|---|---|---|---|
| Tool-calling agent (7 tool + registry + handler) | 1200 | +200 (max 2, bounded scope, evidence exact) | 1400 |
| Prompt per-nodo (11 estinzione + 6 consultazione) | 300 | +100 (test suite + composizione globale) | 400 |
| Gap executedNodeIds + meta counter + cancel | 100 | +50 (atomic turn, rollback) | 150 |
| Session trace + replay + dashboard | 0 | +250 | 250 |
| Chain-of-thought 7 nuovi kind + renderer | 150 | +50 (test UI) | 200 |
| Feature flag + shadow mode | 0 | +150 | 150 |
| Integration test daily LLM reale | 0 | +200 | 200 |
| Unit test (policy invariate, handler, validation) | 500 | +100 | 600 |
| Test e2e parametrizzato sui 2 flow | 400 | +150 (retry logic) | 550 |
| **Totale** | **2650** | **+1250** | **~3900 LoC** |

Tempo di sviluppo stimato: ~3-4 settimane (1 persona senior, inclusa prompt engineering iteration).

## 9. Riepilogo della review — cosa ho cambiato rispetto alla prima proposta

| Prima proposta | Review critica | Decisione finale |
|---|---|---|
| Tool-calling "puro" | Compound failure math: 2 tool/turno × 6 turni = 54% success | **Max 2 tool/turno** + pre-filtro per compound |
| Evidence required | Può essere copy-paste da bot message | **Evidence exact-match SOLO su user message corrente** |
| "Prompt per-nodo" generico | Manutenzione 17+ prompt, rischio divergenza | **Prompt = globalGuardrails + nodeSpecific** componibile |
| "Log leggibili" | Insufficiente per debug | **Session trace JSONL + replay tool + dashboard drift** |
| "Provider support OK" | Schema drift tra versioni | **Integration test daily + version pinning** |
| No metriche target | Impossibile valutare | **5 metriche con target numerici** |
| Chain-of-thought OK | Azioni conversazionali non visibili | **+7 nuovi kind timeline event** per tool call non-extract |
| Rollout "feature flag" | Troppo vago | **Shadow 2w → canary 10% → staging full → prod** |

## 10. La mia raccomandazione definitiva (post-review)

**Procediamo con Modo 3 + Modo 5 + 6 safeguard** come descritti in §4.

Il DAG del flow resta invariato, il builder canvas resta invariato, i fixture restano invariati. Cambia solo il plumbing fra messaggio utente e stato. Le 7 nuove azioni conversazionali (meta, info, topic change, overwrite-pending/confirmed, cancel-requested/confirmed) sono visibili nel chain-of-thought chat-side, non inquinano il DAG.

**Perché ora sono più convinto di prima**:

- La review ha dimostrato che i rischi del tool-calling sono **noti, quantificati e mitigabili** con tecniche specifiche (bounded scope, evidence exact-match, max 2 call, atomic turn).
- Il paper arxiv 2505.23006 + i dati di produzione 2026 convergono su **DAG + tool-calling + prompt per-nodo** come pattern più performante per questi casi (+52% accuracy).
- La soluzione è **incrementale**: possiamo implementare Modo 3 puro prima (senza prompt per-nodo), misurare, poi aggiungere Modo 5 se le metriche lo giustificano.
- Gli operatori bancari vedranno **lo stesso DAG** ma con più "trasparenza" nella chat (chain-of-thought più ricco).

## Fonti

- [Practical Approach for Building Production-Grade Conversational Agents with Workflow Graphs (arxiv 2505.23006)](https://arxiv.org/html/2505.23006v1) — +52% accuracy con workflow graph + per-node prompts
- [LLM Agent Hallucinations Survey 2026](https://arxiv.org/html/2509.18970v1) — taxonomy dei failure mode tool-calling
- [Why AI Agents Fail in Production (Data Science Collective)](https://medium.com/data-science-collective/why-ai-agents-keep-failing-in-production-cdd335b22219) — compound failure rates in produzione
- [AI Agent Harness Failures: 13 Anti-Patterns (Atlan)](https://atlan.com/know/agent-harness-failures-anti-patterns/) — schema drift, context retention 2%/step
- [AgentProp-Bench: Reliability Framework for LLM Agents](https://arxiv.org/html/2604.16706) — judge reliability, propagation cascades, runtime mitigation
- [Beyond ReAct: Planner-Centric Framework](https://arxiv.org/html/2511.10037v1) — DAG planning vs reactive
- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) — tool caching, programmatic, strict mode
- [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — grammar-constrained decoding
