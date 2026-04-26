# INTERACTIVE_FLOW — progress log

Cronologia post-rimozione del fallback legacy (2026-04-26). Per la cronologia precedente delle iterazioni di design e build del command layer, vedi [archive/progress-log-pre-fallback-removal.md](archive/progress-log-pre-fallback-removal.md).

---

## 2026-04-26 — Legacy fallback removed

**Branch**: `feature/command-layer-p0b-infra`
**Plan**: 5 fasi sequenziali per minimizzare compile risk cross-package.

### Modifiche

**Codice runtime eliminato**:
- `packages/server/engine/src/lib/handler/field-extractor.ts`
- `packages/server/api/src/app/ai/overwrite-policy.ts`
- `packages/server/api/src/app/ai/pending-interaction-resolver.ts`
- `packages/server/api/src/app/ai/meta-question-handler.ts`

**Endpoint API**:
- Eliminato `POST /v1/engine/interactive-flow-ai/field-extract` (~600 LoC inclusi helper)
- Mantenuto `POST /v1/engine/interactive-flow-ai/question-generate` (usato per messaggi dinamici USER_INPUT/CONFIRM)

**Branch logic**:
- `interactive-flow-executor.ts`: rimossi i ternari di branching per il flag-toggle (resume + first-turn). Sempre command layer.
- `turn-interpreter-adapter.ts`: rimosso `selectAdapter` + `legacyFieldExtractorAdapter`. `interpretTurn` ora chiama direttamente `commandLayerClientAdapter`.
- `interactive-flow-validator.ts`: `checkCommandLayerCompatibility` rinominato in `checkPostgresRequired`. Vincolo Postgres ora universale per ogni INTERACTIVE_FLOW. Nuovo error code `INTERACTIVE_FLOW_REQUIRES_POSTGRES`, nuovo i18n key `validation.interactiveFlow.requiresPostgres`.

**Schema shared**:
- Rimosso il campo flag-toggle da `InteractiveFlowActionSettings`.
- Bump `@activepieces/shared` 0.69.1 → 0.70.0 (minor: rimozione campo).

**Test eliminati**:
- 13 spec e2e legacy in `packages/tests-e2e/scenarios/ce/flows/interactive-flow/`
- T-15 (`command-layer-legacy-regression.local.spec.ts`), sostituito da nuovo `command-layer-estinzione.local.spec.ts` (3 turni, command layer)
- 4 API unit test (overwrite-policy, pending-interaction-resolver, meta-question-handler, interactive-flow-ai.controller)
- 11 engine unit test (field-extractor, question-generator legacy variants, executor variants, events, llm, session-store-v82)
- 1 API integration test (canary-simulation R-RO.4 — rollback per-flow obsoleto)

**Fixture migrate**:
- `fixtures/flow-templates/estinzione.json`: aggiunto `infoIntents: []` + `errorPolicy: { onFailure: SKIP }` su `search_customer` e `generate_pdf` (AEP-fragili).
- `fixtures/flow-templates/consultazione-cliente.json`: rimosso il campo flag-toggle (ora ridondante).

**i18n** (12 locales):
- Rinominata chiave `validation.commandLayer.requiresPostgres` → `validation.interactiveFlow.requiresPostgres`.
- Eliminata chiave non usata `validation.commandLayer.featureDisabled`.
- Aggiornati i messaggi per rimuovere riferimento al flag.

**Documentazione**:
- 14 doc storici archiviati in `docs/interactive-flow/archive/` con README disclaimer.
- Eliminati: `command-layer-migration-guide.md`, `coverage-baseline.md`, `w09-smoke-checklist.md`, `sunset-checklist.md`.
- Aggiornati: `command-layer-developer-guide.md`, `architecture-command-layer-vs-previous.md`.
- Aggiornati CLAUDE.md/AGENTS.md (root, `packages/server/AGENTS.md`, `packages/server/engine/CLAUDE.md`).

### Verifica done condition

Scrubbing finale: nessun riferimento al flag-toggle (la stringa è citata solo in `archive/` per ragioni storiche).

### Test suite

- 351/351 engine unit test (vitest) ✓
- 354/354 API test (integration + unit) ✓ (= 145 command-layer integration + 209 unit)
- 14/14 Playwright command-layer specs (incluso nuovo `command-layer-estinzione`) ✓
- `npm run lint-dev` exit 0 ✓
- `npm run check-migrations` no drift ✓

### Commit (cronologia finale)

- Fase 1: `4b5a2d6e83` — eliminate legacy tests
- Fase 2: `037c8565c7` — command layer is the default + migrate estinzione
- Fase 3: `0b63d10c2d` — eliminate legacy modules + endpoint /field-extract
- Fase 4 + 5: in arrivo
