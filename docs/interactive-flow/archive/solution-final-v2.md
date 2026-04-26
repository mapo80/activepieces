# Soluzione definitiva v2 — dopo review iterativa sui 10 attacchi

> Questo documento prende la proposta di [solution-final-review.md](./solution-final-review.md), la sottopone ai 10 attacchi rigorosi che io stesso ho sollevato, valuta onestamente quali sono **validi** e quali no, e produce la **versione v2 corretta** della soluzione. Dove ho sbagliato, lo dico esplicitamente.

## Sintesi dei verdetti

| Attacco | Validità | Correzione alla proposta |
|---|---|---|
| **#1** Compound failure math | Parzialmente valido | Rimuovo numeri speculativi, mantengo principio qualitativo |
| **#2** Bounded scope vs batched | **Completamente valido** | Bounded = prompt engineering, NON tool restriction |
| **#3** Paper fine-tuning vs prompt | **Completamente valido** | +6% reale, non +52%. Scarto Modo 5 |
| **#4** Max 2 tool arbitrario | **Completamente valido** | Semantic constraint (max 1 per action type), non limite numerico |
| **#5** Shadow mode impossibile | **Completamente valido** | Sostituisco con test suite statico + parallel log |
| **#6** DAG + chain-of-thought = 2 mental model | Non valido | Operatore non vede il DAG, solo chain-of-thought |
| **#7** Cache TTL 5 min | Parzialmente valido | Costo realistico 2-3x, non 1.2x |
| **#8** Cancel triggerable per errore | Parzialmente valido | UI distintiva pending_cancel (bottone rosso) |
| **#9** R1 copre 95% a 40% costo | Dipende da business | Decisione non puramente ingegneristica |
| **#10** Fallback è placebo | Valido | 3 livelli di fallback espliciti |

**Bilancio**: **5 attacchi completamente validi**, 3 parzialmente, 1 non valido, 1 dipende. Score 6.5/10 pro-attacco. **La proposta originale era difettosa su punti importanti**. La v2 è significativamente rivista.

---

## Dettaglio per ciascun punto

### #1 — Compound failure math: PARZIALMENTE VALIDO

**Attacco**: *"i tuoi 0.95² = 90% sono inventati. Il nostro sistema attuale a 0.95⁶ = 74% dovrebbe mostrare crash significativi, invece i test e2e passano >90%."*

**Autoanalisi**:
- Vero: ho inventato i numeri. Mea culpa.
- Vero: le accuracies non sono indipendenti. Se l'LLM capisce `customerName`, probabilmente capisce anche la domanda associata nello stesso messaggio (correlation positiva).
- Vero: i nostri e2e passano al 90%+. Il modello moltiplicativo è troppo pessimista.
- **Ma**: il principio qualitativo resta. Più tool call per turno = più superficie di errore, anche se la correlation è positiva (non è 1.0). Chiamare 5 tool in un turno è più rischioso di chiamarne 1.

**Cosa correggo**:
- Rimuovo i numeri speculativi dalla proposta (erano un'enfasi retorica sbagliata)
- Mantengo il principio: **turni con molte tool call sono più rischiosi**. Safeguard pragmatico, non matematico.
- Aggiungo: **misureremo** il turn accuracy in produzione su 100 turni campione per definire i threshold reali.

**Verdetto**: il math era sbagliato, il principio no. Safeguard mantenuto ma giustificato come prudenza, non come matematica.

---

### #2 — Bounded scope vs batched input: COMPLETAMENTE VALIDO

**Attacco**: *"al nodo `pick_ndg` con bounded scope stretto, un operatore che scrive 'Bellafronte, NDG 11255521, motivazione 01, data 26/04' perde 3 valori su 4. Incompatibile col batched che è nostro use case testato (A1 one-shot-full)."*

**Autoanalisi**:
- **Attacco fatale**. Il bounded scope stretto rompe esplicitamente il batched input che è nei nostri test e2e (`A1 one-shot-full`).
- Rileggendo il paper 2505.23006: il bounded scope del paper si riferisce al **prompt specializzato** (node-specific instructions), NON alla restrizione dei tool disponibili. Stavo conflando due concetti.
- La mia formulazione ("al nodo `pick_ndg`, `setStateField` accetta solo `field='ndg'`") era sbagliata.

**Cosa correggo**:
- Tool **sempre disponibili** (ogni nodo vede tutti): `setStateField`, `respondInfo`, `respondMeta`, `requestOverwrite`, `requestCancel`, `acknowledgePending`, `continueFlow`
- **Restrizione per campo**, non per nodo: `setStateField` rifiuta **solo** campi `node-local` quando currentNode non matcha (già lo fa oggi via `extractionScope`)
- Il prompt per-nodo (Modo 5) **guida** la preferenza ma non restringe il set di azioni

**Verdetto**: attacco valido al 100%. Correggo la definizione di bounded scope.

---

### #3 — Paper fine-tuning non è trasferibile: COMPLETAMENTE VALIDO

**Attacco**: *"+52% nel paper è con fine-tuning 27B-32B su dominio e-commerce. Noi usiamo Claude senza fine-tuning. È cherry-picking disonesto."*

**Autoanalisi**: rileggo il paper 2505.23006 con attenzione:

| Configurazione | Accuracy | Format Adherence |
|---|---:|---:|
| Baseline (LLM libero) | 74.4% | 65.5% |
| Workflow Graph (prompt per-nodo SENZA fine-tuning) | **79.0%** | 95.1% |
| Workflow Graph + Fine-tuning | 89.0% | 98.7% |

**Il prompt per-nodo da solo fa +4.6% accuracy** e +29.6% format adherence sul baseline. Il +52% che ho citato era il guadagno TOTALE con fine-tuning — che noi non faremo.

Disonesto? Non intenzionalmente, ma in pratica sì: ho venduto un numero di fine-tuning come fosse prompt engineering pure.

**Cosa correggo**:
- Il guadagno realistico del Modo 5 (prompt per-nodo) è **+5% accuracy + +30% format adherence**
- Costo di Modo 5: 11 prompt estinzione + 6 consultazione + manutenzione + test regression (~400 LoC + carico cognitivo continuo)
- Trade-off: +5% accuracy vale 400 LoC di prompt manutenzione? Dipendente dai numeri attuali. Se oggi siamo a 90%+, guadagnare 5 punti per arrivare a 95% vale molto. Se siamo già a 96%, poco.
- **Non abbiamo un baseline measure del sistema attuale**. Senza quello, decidere su Modo 5 è speculativo.

**Verdetto**: attacco fondato. Cambio strategia:
- **Fase 1 implementa Modo 3 puro** (tool-calling senza prompt per-nodo) — guadagni certi (compound, observability, 7 kind timeline)
- **Misuriamo turn accuracy in produzione** per 2 settimane
- **Fase 2 valuta Modo 5** solo se la misura mostra gap da colmare

In questo modo non pago 400 LoC di prompt per-nodo se la misura dimostra che non servono.

---

### #4 — Max 2 tool call arbitrario: COMPLETAMENTE VALIDO

**Attacco**: *"perché 2 e non 3 o 5? Uno scenario realistico (cambia N campi + info) richiede più tool."*

**Autoanalisi**:
- Vero: il 2 è arbitrario. Non ho giustificazione.
- Il REALE problema non è il numero di tool, ma la composizione. 
- Multiple `setStateField` non sono rischiose (ciascuna ha validation evidence + enum + scope indipendente): se una fallisce non inquina le altre.
- Un singolo `respondInfo` + un singolo `setStateField` è ragionevole.
- Ripetizioni strane di azioni conversazionali (2 respondInfo nello stesso turno, 2 requestCancel) invece sono sospette.

**Cosa correggo**: sostituisco "max 2 tool" con constraint semantici:

- `setStateField`: **illimitato** per turno (ogni field è validato indipendentemente)
- `respondMeta`: **max 1** per turno (non ha senso duplicare)
- `respondInfo`: **max 1** per turno (idem)
- `requestOverwrite`: **max 1** per turno (idem, pending interaction singola)
- `requestCancel`: **max 1** per turno
- `acknowledgePending`: **max 1** per turno (è una risposta sì/no, non si ripete)
- `continueFlow`: **max 1** per turno

In più: atomic turn. Se una tool call in un turno fallisce validation, rollback di tutte.

**Verdetto**: attacco valido. Correggo con semantic constraints.

---

### #5 — Shadow mode impossibile: COMPLETAMENTE VALIDO

**Attacco**: *"tool-call output e JSON monolitico hanno shape diverse. Il confronto shadow richiede un mapper che può buggato. Shadow = teatro."*

**Autoanalisi**:
- **Vero**. Gli output non sono isomorfi. Un mapper tool-call → JSON mono introdurrebbe bias.
- Esempio: shadow dice "tool-call avrebbe fatto X, JSON ha fatto Y" — ma Y include `metaAnswer` ignorato, mentre X usa `respondMeta`. Non sono confrontabili direttamente.
- Shadow mode vero funziona solo quando le due versioni producono output isomorfi (es. due diverse pipeline di extraction che estraggono gli stessi field → confronto diretto).

**Cosa correggo**: sostituisco con **3 strategie più oneste**:

1. **Test suite statico di regressione**: 50 turni annotati (input → expected state change). Eseguiti su Modo 1 (baseline) e Modo 3. Compariamo il delta accuracy turno-per-turno. Deterministic, riproducibile.
2. **Parallel logging in staging**: per 1 settimana, sia Modo 1 che Modo 3 processano lo stesso input. Output divergenti vengono loggati e annotati manualmente da un operatore umano. Qualitativo, piccola scala.
3. **Canary production per flow non-dispositivi**: iniziamo abilitando Modo 3 SOLO sulla consultazione cliente (read-only). Se qualcosa va male, perdita = zero (non ci sono operazioni dispositive). Estendiamo ad estinzione solo dopo 2 settimane senza incidenti.

**Verdetto**: attacco valido. Sostituisco shadow mode con approccio più pragmatico e realistico.

---

### #6 — DAG + chain-of-thought = 2 mental model: NON VALIDO

**Attacco**: *"operatore deve sintetizzare DAG e chain-of-thought. UX peggiore."*

**Autoanalisi**:
- L'operatore **non vede il DAG**. Il DAG è visibile solo al developer/admin nel builder canvas, mai all'operatore che usa la chat pubblica.
- L'operatore vede UN solo mental model: la chat con messaggi + chain-of-thought ("Passi eseguiti").
- Le nuove azioni conversazionali (💬 meta, ℹ️ info, 🛑 cancel, ecc.) sono annotazioni dentro lo stesso chain-of-thought esistente, non un secondo mental model.
- Il developer che guarda il builder canvas vede il DAG invariato.

**Verdetto**: attacco non valido. Ho già una separazione chiara (canvas per dev, chat per operatore). Rigetto.

---

### #7 — Prompt caching 5 min TTL: PARZIALMENTE VALIDO

**Attacco**: *"operatori pensano/digitano più di 5 min tra turni. Cache miss frequenti. Costo 2-3x del tuo calcolo."*

**Autoanalisi**:
- Vero: Anthropic prompt cache ha TTL 5 min.
- Vero: operatori bancari hanno turni "pensati" (verifica documento cliente, riflessione su motivazione), con pause > 5 min.
- Tuttavia: turni rapidi (click da lista, conferma veloce) sono entro il TTL.
- Realisticamente: assumo 50% cache hit, 50% miss.

**Calcolo corretto**:
- System prompt con tool definitions: ~1800 token
- Cache hit: $0.30/Mtoken (Anthropic cached read) → $0.00054
- Cache miss: $3/Mtoken (normal input) → $0.0054
- **Media**: ~$0.003 per turno di input (+ output costi, stabili)
- **Totale turno**: ~$0.005 (vs $0.003 attuale). **Incremento ~1.7x**, non 2-3x né 1.2x.

**Cosa correggo**: aggiorno la stima costo a **1.5-2x del baseline** (vs 1.2x originale).

**Verdetto**: attacco valido nel segnale (costi più alti di quanto detto), ma 2-3x era un'overstima. Il numero corretto è 1.5-2x. Comunque < $0.01/turno, accettabile per banking (tasso orario operatore filiale ~€30-50).

---

### #8 — Cancel triggerable per errore: PARZIALMENTE VALIDO

**Attacco**: *"'basta così, confermo' → LLM emette requestCancel → operatore conferma pensando ad altro → state cleared. Perdita di 5 turni di lavoro."*

**Autoanalisi**:
- Lo scenario è plausibile ma mitigabile.
- La double-confirmation del pending_cancel è la prima difesa. Ma l'attacco contesta che la double-confirmation può essere confusa con altre conferme pendenti.
- La critica è seria per un flow dispositivo come estinzione.

**Cosa correggo** — 3 misure di sicurezza:

1. **UI distintiva**: il pending_cancel ha bottone rosso "🛑 Sì, annulla" vs grigio/outlined "Continua". Diverso dal confirm_binary per la conferma finale (verde "Confermo invio" vs default "Annulla").
2. **Wording esplicito**: il messaggio bot al pending_cancel è *"Vuoi davvero annullare la pratica? Tutti i dati inseriti (cliente, rapporto, motivazione) verranno persi."* Impossibile confondere con un confirm.
3. **Anti-false-positive**: il classifier LLM emette `requestCancel` solo se il messaggio contiene **parole esplicite di annullamento** (`annulla`, `basta`, `ricomincio`, `cancella`, `non voglio più`). Se il messaggio contiene anche parole di conferma (`confermo`, `procedi`), preferisce `acknowledgePending` su pending esistente o `continueFlow`.

**Verdetto**: attacco valido, correggo con 3 safeguard UX + prompt.

---

### #9 — R1 (minimum) copre 95% a 40% del costo: DIPENDE DAL BUSINESS

**Attacco**: *"compound è 5% dei casi. Stai pagando 2300 LoC extra per coprire quel 5%. Over-engineering."*

**Autoanalisi**:
- La stima 5% è mia senza dati. Potrebbe essere 2% o 20%.
- Ma il compound non è l'unico guadagno di Modo 3. Altri:
  - **Log strutturati** (debugging produzione mille volte più facile)
  - **Schema strict** (zero parse error, vs occasionali zod fail oggi)
  - **Estendibilità** (nuova capacità = +1 tool, vs +1 variant nell'intent union)
  - **Standard industriale** (onboarding nuovi sviluppatori, prompt engineer più facile da trovare)
- R1 (JSON monolitico esteso) ha debito tecnico crescente: ogni nuovo scenario = nuovo if/else nel dispatcher.

**Valutazione onesta**:
- Se prevediamo di restare **sempre** a 2-3 flow simili a quelli attuali, R1 è razionale.
- Se prevediamo di aggiungere **nuovi** tipi di flow con pattern conversazionali diversi (es. FAQ, ricerca guidata, consulenza), R1 diventa insostenibile e R4 paga sul medio termine.
- **Decisione non puramente ingegneristica**: dipende dal business roadmap.

**Cosa correggo**: aggiungo alla proposta una **sezione "Decision matrix"** che chiede al business:

> Prevediamo nei prossimi 12 mesi di aggiungere più di 2 flow INTERACTIVE_FLOW di pattern diverso (non solo variazioni di estinzione)?
> - Sì → Modo 3 è giustificato
> - No → Modo 1 esteso (R1) è adeguato

Senza questa risposta, non ha senso decidere ingegneristicamente.

**Verdetto**: attacco valido e rilevante. Serve input dal business prima di procedere.

---

### #10 — Fallback è placebo: VALIDO

**Attacco**: *"fallback insufficient-info è un template generico. Frustration per l'operatore."*

**Autoanalisi**:
- Vero: il fallback attuale è generico.
- Migliore: gestire 3 livelli di failure esplicitamente.

**Cosa correggo** — 3 livelli:

| Livello | Scenario | Comportamento |
|---|---|---|
| **L1 — Transient** | Zod parse fail (1 volta) | Retry automatico con stesso prompt. Latenza +1s |
| **L2 — Provider down** | 2 retry fallite, timeout > 10s | Bubble esplicita: *"Servizio AI temporaneamente non disponibile. Riprova tra qualche secondo."* |
| **L3 — Persistent confusion** | Dopo retry L1, output malformato o validation fallite | Fallback template mirato: *"Non sono riuscito a elaborare la sua richiesta. Può indicarmi [primaryField] in modo più chiaro?"* (con primaryField dal nodo corrente) |

Tutti i livelli vengono **loggati** con category per analisi.

**Verdetto**: attacco valido, aggiungo 3 livelli di fallback espliciti.

---

## La soluzione v2 — integrando le correzioni

### Architettura finale (v2)

**Layer LLM → server**: Modo 3 (tool-calling). 7 tool strutturati + Zod schema strict.

**Layer business logic**: tool executor registry + handler puri + atomic turn rollback.

**Layer policy** (invariato dal sistema attuale):
- Evidence exact-match su user message corrente (NEW: exclusion di bot message)
- Admissibility (extractionScope global/node-local)
- Domain (enumFrom catalog)
- Plausibility (regex, length)

**Layer conversazione**:
- Pending interaction extension: `confirm_binary`, `pick_from_list`, `pending_overwrite`, **`pending_cancel`** (nuovo)
- Dialogue history persisted in session record
- Topic change con invalidate downstream (state + executedNodeIds + skippedNodeIds)
- Loop prevention counter consecutive meta/info (max 3)

**Layer UI/UX**:
- Chain-of-thought chat-side esteso con 7 nuovi kind timeline event
- `pending_cancel` con UI distintiva (bottone rosso "🛑 Sì, annulla")
- DAG builder canvas **invariato**

**Safeguard** (post-review):
1. Semantic constraints sul numero di tool call per tipo (illimitate setStateField, max 1 per azioni conversazionali)
2. Evidence exact-match sul messaggio user corrente (escluso bot message)
3. Atomic turn rollback se validation fallisce per una tool call
4. Anti-false-positive cancel: keyword esplicite, disambiguazione con conferma pendente
5. 3 livelli di fallback (retry / provider-down / insufficient-info mirato)
6. Session trace JSONL + replay tool + dashboard drift
7. Test suite statico di 50 turni annotati (regression gate a ogni merge)
8. Integration test daily LLM reale (catch schema drift provider)
9. Version pinning del provider (claude-4-5-20250929, non `-latest`)
10. Prompt caching Anthropic per system prompt (riduzione costo)

**Scarto dalla proposta originale**:
- **Modo 5 (prompt per-nodo)**: scartato per v1. Il guadagno reale (+5% accuracy, non +52%) non giustifica 400 LoC + carico cognitivo di manutenzione prima di avere una baseline measure. Rivalutabile in Fase 2.

### Decisione di business richiesta

Prima di approvare l'implementazione serve risposta a:

> **Prevedi di aggiungere nei prossimi 12 mesi più di 2 flow INTERACTIVE_FLOW con pattern conversazionali diversi da quelli attuali (non solo variazioni bancarie del tipo estinzione/consultazione)?**

- **Sì** → Modo 3 giustificato, procedere.
- **No** → Modo 1 esteso (R1) è adeguato, ~1500 LoC invece di 3500. Risparmio 60%.
- **Non lo so** → Procediamo con R1 ora, upgrade a Modo 3 in Q2 se emergono esigenze. Costo rifacimento ~500 LoC (handler → tool registry).

### Stima costi corretta (v2)

| Voce | LoC |
|---|---|
| Tool-calling agent (7 tool + handler registry + validation) | 1400 |
| `pending_cancel` + cancel-handler + UI distintiva | 200 |
| Semantic constraint validation + atomic turn rollback | 150 |
| Evidence exact-match estensione | 50 |
| `invalidatedNodeIds` + loop prevention counter | 100 |
| 7 nuovi kind timeline event + renderer | 150 |
| 3 livelli fallback | 100 |
| Session trace + replay | 200 |
| Test suite statico 50 turni (gate merge) | 400 |
| Integration test daily LLM reale | 200 |
| Test unit handler + validation | 400 |
| Test e2e parametrizzato sui 2 flow | 500 |
| Version pinning + prompt cache wiring | 50 |
| **Totale** | **~3900 LoC** (come prima, Modo 5 scartato compensato da safeguard extra) |

Tempo stimato: 3-4 settimane con dev senior. Rollout: 1 settimana test suite, 1 settimana canary consultazione, 2 settimane monitor estinzione.

### Stima costo operativo corretta (v2)

- Input con tool definitions + cache mix (50/50): **~$0.003/turno**
- Output tokens stabili: **~$0.002/turno**
- **Totale**: ~$0.005/turno (vs $0.003 attuale, +65%)
- Turni/flow tipico estinzione: 5-7
- Costo per flow completo: ~$0.03
- Accettabile per banking (operatore filiale costa ~€0.50/min di lavoro)

### Metriche target (v2)

| Metrica | Target v1 | Come misurare |
|---|---|---|
| Turn accuracy | ≥ 95% (da baseline misurato) | Test suite 50 turni + annotazione manuale 100 turni produzione |
| Flow completion rate | ≥ 80% | % sessioni che raggiungono terminale |
| Tool call validation failure | ≤ 2% | validation rejected / total emitted |
| Parameter fabrication rate | ≤ 0.5% | evidence mismatch / setStateField calls |
| False-positive cancel rate | ≤ 0.1% | requestCancel emesse / turni totali (dove non era cancel) |
| Fallback L2/L3 rate | ≤ 1% | trigger / turni totali |
| p95 latency per turno | ≤ 3s | end-to-end |
| Cache hit rate | ≥ 40% | Anthropic cache metrics |

## Conclusione — la v2 è significativamente migliore della v1

**Cambi strutturali**:
- Scartato Modo 5 (prompt per-nodo) in Fase 1
- Aggiunto decisione business esplicita (+2 flow in 12 mesi?)
- Sostituito "max 2 tool" con semantic constraints
- Sostituito "bounded scope stretto" con restrizione SOLO per node-local fields
- Sostituito "shadow mode" con test suite statico + canary consultazione
- Aggiunta UI distintiva pending_cancel
- Aggiunti 3 livelli di fallback
- Corretto costo realistico a 1.5-2x (non 1.2x)

**Cosa è rimasto**:
- Modo 3 come core
- 7 tool del registry
- Safeguard di validation riusate al 100% dal sistema attuale
- DAG del flow invariato
- Chain-of-thought arricchito con 7 nuovi kind

**La proposta ora è difendibile**. Gli attacchi che rimangono potenzialmente validi (#1 e #7) sono questioni di grado, non di principio.

**Prima di implementare, voglio la risposta alla domanda di business**: prevedi altri tipi di flow nei prossimi 12 mesi?

Senza quella risposta, ogni stima costo/beneficio è incompleta.

## Fonti (verificate durante la review)

- [Workflow Graphs for Conversational Agents (arxiv 2505.23006)](https://arxiv.org/html/2505.23006v1) — rilettura attenta ha rivelato che +52% è con fine-tuning; +5% con solo prompt per-nodo
- [LLM Agent Hallucinations Survey 2026](https://arxiv.org/html/2509.18970v1)
- [Anthropic Prompt Caching](https://docs.anthropic.com/en/docs/prompt-caching) — TTL 5 min, pricing differenziato
- [Why AI Agents Fail in Production](https://medium.com/data-science-collective/why-ai-agents-keep-failing-in-production-cdd335b22219)
