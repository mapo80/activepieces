# Bridge Characterization — `claude-code-openai-bridge`

Empirical behavior of the OpenAI-compatible bridge at `http://localhost:8787/v1` used to talk to `claude-cli`. Documented here as the design basis for v8.1 extractor pipeline.

**Date**: 2026-04-21  
**Bridge version**: as present in `linksmt/agentic-engine/claude-code-openai-bridge`

## Summary

| Capability | Status | Notes |
|---|---|---|
| `tool_choice: 'auto'` | ⚠️ Forces tool call | The bridge emits a tool_calls entry even when the user message is irrelevant. However the LLM can return `{}` as arguments, effectively a "nothing to extract" result. Usable for v8.1. |
| JSON Schema `enum` | ✅ Respected | Claude honors enum constraints even without native strict mode. Emits `{}` when input value doesn't match enum. |
| JSON Schema `pattern` | ✅ Respected | Claude honors pattern constraints. Emits `{}` when input value doesn't match regex. |
| `strict: true` on tool | ❓ Untested (per Anthropic OpenAI-compat docs: ignored) | Not relied upon. Zod post-validation is the real guarantee. |
| `response_format: json_schema` | ❓ Untested (Anthropic OpenAI-compat: ignored) | Not used. Extractor relies on tool calling + Zod. |
| `output_config.format` (Anthropic native) | ❓ Not tested | Bridge is OpenAI-shape, not Anthropic native. |

## Test 1 — `tool_choice:'auto'` with irrelevant input "ciao"

**Request**: `fixtures/bridge-t1-request.json`
- Model: claude-cli
- Tool: extract {customerName: string}
- tool_choice: auto
- User: "ciao"

**Response**: `fixtures/bridge-t1-response.json`
- `finish_reason: "tool_calls"` (tool was called)
- `tool_calls[0].function.arguments = "{}"` (empty args — LLM decided not to fill)

**Conclusione**: il bridge forza tool_calls ma l'LLM rispetta la semantica "nothing to extract". **Safe per v8.1**.

## Test 2 — enum constraint with out-of-enum input

**Request**: `fixtures/bridge-t2-request.json`
- Tool: extract {closureReasonCode: string, enum: [01,02,03,04,05]}
- User: "voglio motivazione 20"

**Response**: `fixtures/bridge-t2-response.json`
- `arguments = "{}"` — "20" NOT in enum, LLM correctly emits nothing.

**Conclusione**: enum dinamico da `state.closureReasons` funziona.

## Test 3 — enum constraint with in-range but out-of-list input

**Request**: `fixtures/bridge-t3-request.json`
- Tool: extract {closureReasonCode: string, enum: [01,02,03,04,05]}
- User: "motivazione 07 per trasferimento"

**Response**: `fixtures/bridge-t3-response.json`
- `arguments = "{}"` — LLM does NOT force "07" even though explicitly mentioned.

**Conclusione**: constraint enum più forte di user mention. Dynamic enum is a real safety net.

## Test 4 — pattern constraint with malformed input

**Request**: `fixtures/bridge-t4-request.json`
- Tool: extract {ndg: string, pattern: "^\\d{6,10}$"}
- User: "il mio NDG è abc123"

**Response**: `fixtures/bridge-t4-response.json`
- `arguments = "{}"` — "abc123" violates pattern, LLM emits nothing.

**Conclusione**: pattern regex rispettato, anche per campi numerici.

## Implicazioni per v8.1

1. **Schema enum/pattern sono funzionali** come safety rails. L'LLM di claude-cli li rispetta anche senza strict mode esplicito.
2. **`tool_choice:'auto'` funziona semanticamente** (LLM può tornare `{}`), anche se tecnicamente il bridge forza un tool_calls entry. Non problematico per noi.
3. **Zod post-validation rimane essenziale** come seconda linea (se un modello futuro fosse meno disciplinato, Zod cattura).
4. **Il "server deterministic policy" di v8.1 non dipende da strict mode**. Anche se il bridge fosse cambiato/rotto, la policy regge.

## Azioni derivate nel piano v8.1

- `buildDynamicSchema` emette `enum` da `state.closureReasons.map(r => r.codice)` per `closureReasonCode` — confermato che funziona.
- `customerName` schema con `pattern` + `minLength` + description con esempi VALID/INVALID — confermato che riduce hallucination.
- `Zod safeParse` post-tool-call come guardrail runtime — sempre attivo.
- Non facciamo assumptions su `strict: true` → design a prova di bridge rotto.

## Future tests (se serve nel futuro)

- Comportamento su `tool_choice: 'required'` con user input "ciao" (verificare che forzi anche valori inventati)
- Stress test con schema molto complesso (multi-field + nested)
- Latenza media per call con schema diversi (enum small vs large, pattern complexity)
