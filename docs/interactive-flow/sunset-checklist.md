# Phase 7 — Legacy Sunset Checklist

> Roadmap di rimozione del path legacy `fieldExtractor.extractWithPolicy` + endpoint `/v1/engine/interactive-flow-ai/field-extract` + `meta-question-handler.ts` dopo che il command layer (Phase 0-6) è stabile in produzione.

**Pre-requisito**: Phase 6-CANARY-DISPOSITIVO complete con 2 settimane di stabilità a 100% rollout.

## Sunset gates (tutti verdi prima di iniziare)

| Gate | Criterio | Status |
|---|---|---|
| Stabilità prod | 2 settimane consecutive con error rate ≤ 2% | TBD |
| Adoption rate | ≥ 95% sessioni su command layer | TBD |
| Compliance sign-off | Compliance/legal accetta dismissione legacy | TBD |
| Data retention | Sessioni legacy ≥ 30 giorni di età | TBD |
| Documentation | Migration guide pubblicata per integratori external | TBD |

## Codice da rimuovere

### Engine

- `packages/server/engine/src/lib/handler/field-extractor.ts`
  - File completo (sostituito da `turn-interpreter-client.ts` + `turn-interpreter-adapter.ts`)
- `packages/server/engine/src/lib/handler/interactive-flow-executor.ts`
  - Branch `else` di entrambi i punti di iniezione (linee ~1014, ~1116):
    chiamata a `fieldExtractor.extractWithPolicy(...)` da rimuovere
  - Helper `adaptTurnResultToExtractResult` da rimuovere (TurnResult diventa output diretto)
  - Variabile `commandLayerFinalizeContract` diventa sempre presente (no opzionale)
  - Riferimenti a `PolicyDecision` legacy type da rimuovere o riallineare a `InterpretTurnPolicyDecision`

### API

- `packages/server/api/src/app/ai/interactive-flow-ai.controller.ts`
  - Endpoint `POST /v1/engine/interactive-flow-ai/field-extract` da rimuovere
  - Endpoint `POST /v1/engine/interactive-flow-ai/generate-question` (verificare se ancora usato)
- `packages/server/api/src/app/ai/meta-question-handler.ts`
  - File completo (assorbito da PreResolvers + ANSWER_META command in dispatcher)
- `packages/server/api/src/app/ai/pre-parser.ts`
  - Verificare se ancora usato; molti pattern sono assorbiti dai PreResolvers
- `packages/server/api/src/app/ai/reason-resolver.ts`
  - Verificare se assorbito dal PolicyEngine candidate-policy verifyDomain
- `packages/server/api/src/app/ai/overwrite-policy.ts`
  - Verificare se ancora usato dal command layer (overwrite-policy.detectCueOfCorrection
    è usato in turn-log? → mantenere finché necessario)

### Worker module

- `packages/server/api/src/app/workers/worker-module.ts`
  - Rimuovere `app.register(interactiveFlowAiController, ...)` se controller eliminato

## Settings shared

- `packages/shared/src/lib/automation/flows/actions/interactive-flow-action.ts`
  - `InteractiveFlowActionSettings.fieldExtractor` rimanere come optional (legacy fallback during transition) o rimuovere
  - `InteractiveFlowActionSettings.questionGenerator` come sopra
  - `useCommandLayer` flag rimanere ma diventare default `true`

## Database cleanup (dopo sunset)

- Tabella `store-entry` colonna `version` rimanere (additive non-breaking)
- Tabelle `interactive_flow_turn_log`, `interactive_flow_outbox`,
  `interactive_flow_session_sequence` rimanere (sono il nuovo
  storage di produzione)
- Migration drop di colonne legacy non necessaria — tutto additive

## Test cleanup

- `packages/server/api/test/integration/ce/ai/`:
  - Mantenere: `command-layer*.test.ts`
  - Rimuovere se obsoleti: testfile riferiti a fieldExtractor / meta-question-handler /
    pending-interaction-resolver legacy
- `packages/server/engine/test/`:
  - Rimuovere mock di field-extractor se non più referenziati

## Documentation

- `docs/interactive-flow/`:
  - `solution-final-v3.3.md` rimane come storical reference (architettura attuale)
  - `progress-log.md` chiudibile con entry "Phase 7 sunset complete"
  - Nuovo `command-layer-developer-guide.md` da creare per onboarding nuovi
    integratori
- `CLAUDE.md` (root e engine):
  - Aggiornare i riferimenti al `field-extract` endpoint con `command-layer`
- API documentation:
  - Aggiornare OpenAPI/Swagger per rimuovere endpoint legacy

## Comunicazione

- Annuncio interno: rimozione legacy in changelog
- Migration guide per fixture template esistenti che usano `fieldExtractor.aiProviderId`
  e `questionGenerator` (verificare quali fixture nel repo richiedono adjustment)
- Notifica a community se Activepieces fork ha contributors esterni

## Rollback plan

- Branch `pre-sunset-snapshot` conserva lo stato attuale (con legacy code)
- Se sunset rivela bug critici → revert merge, redeploy snapshot
- Window: 30 giorni post-sunset per rollback

## Criterio di chiusura sunset

- Codice legacy rimosso ✓
- Test legacy rimossi ✓
- Documentation aggiornata ✓
- 30 giorni post-sunset senza regressioni reportate ✓
- Tag `command-layer-only` su main ✓

---

Generato come parte della Phase 7 documentation. Da riprendere e completare
quando Phase 6 production rollout sarà finalizzata e stabilità verificata.
