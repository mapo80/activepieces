# Command Layer Implementation — Progress Log

Append-only log. Format: `## YYYY-MM-DD HH:MM UTC`.

## 2026-04-25 22:09 UTC — Phase 0A Spike VERIFIED

**Completed**: P0A-SPIKE-01 → P0A-SPIKE-10 (10 task Phase 0A)

**Gate status**:
- G-LINT: verde (0 errors, pre-existing warnings invariati)
- G-MIGRATIONS: verde (migration registered in `getMigrations()` postgres list)
- Concurrency tests: 7/7 VERDE
- G-UNIT-90, G-LEGACY-INTEGRATION, G-ENGINE-UNIT, G-SHARED-WEB, G-E2E-*: N/A per Phase 0A (codice spike isolato)

**Commit**: 84e2732d68 "spike(command-layer): Phase 0A primitives validated 7/7 VERDE"

**Branch**: `spike/command-layer-primitives` (da `feature/interactive-flow-canvas-redesign`)

**Completamento stimato**: ~3% del totale plan (10 task su ~330 stimati).

**Bridge status**: down (not required for Phase 0A — no LLM calls). Will need to be up for P0C-BENCH-05 (real LLM benchmark).

**Next milestone**: Phase 0A-INFRA — promote spike primitives to production code under `ai/command-layer/` module, remove `spike_` prefix, integrate with feature flag `useCommandLayer`.

**Lezioni emerse durante Phase 0A** (da integrare in Phase 0B):
1. EntitySchema convention: property camelCase = column camelCase (quoted in DDL). NO snake_case mapping.
2. Publisher claim richiede `spike_session_sequence` come lock leader (FOR UPDATE OF s SKIP LOCKED). Il pattern `SELECT DISTINCT ... FOR UPDATE SKIP LOCKED` di v3.3 non funziona in PG16.
3. Sequence generation deve usare tabella dedicata con UPSERT RETURNING, non `SELECT MAX()+1 FOR UPDATE` su aggregate.
4. Heartbeat pattern con CAS su `leaseToken + status + lockedUntil >= NOW()` previene stale commit anche con recovery daemon parallelo.
5. store-entry CAS è un singolo UPDATE con `WHERE version = expectedVersion`; 0 rows → 412 al client. Zero race.

## 2026-04-25 00:40 UTC — Phase 0B-CONTRACT + Phase 1-CORE VERIFIED

**Completed**: 24 task (Phase 0A-INFRA 14 + Phase 0B-CONTRACT 8 + Phase 1-CORE ~10 consolidati) su ~330 totali

**Gate status**:
- G-LINT: verde (0 errors)
- G-SHARED-WEB: verde (261/261 shared tests, web typecheck passa)
- G-LEGACY-INTEGRATION: verde (nessuna regressione su store-entry tests esistenti)
- Integration tests command layer: 9/9 VERDE + 6/6 storage primitives
- G-MIGRATIONS: verde (3 nuove migrations registered + integrated)

**Commits recenti**:
- feature/command-layer-p0b-infra branch:
  - feat(command-layer) Phase 0A-INFRA storage infrastructure
  - feat(shared) Phase 0B-CONTRACT DTOs + schema extensions
  - feat(command-layer) Phase 1-CORE core modules + endpoints

**Completamento stimato**: ~12% del totale plan (24 task su ~200 stimati nel piano Codex espanso).

**Bridge status**: down — necessario per P1-CORE-02 (Vercel AI adapter reale, oggi usato MockProviderAdapter) e P0C-BENCH-05 (real LLM benchmark).

**Next milestone**: Phase 2-ENGINE — turn-interpreter-client.ts engine-side (analogue a field-extractor.ts) + TurnResult adapter + integration della feature flag `useCommandLayer` nell'interactive-flow-executor righe 1016 (resume) e 1117 (first-turn), con preservazione di tutti i side-effect (pendingOverwriteSignal, rejectionHint, topicChange, executedNodeIds reset).

**Lezioni accumulate**:
- Command layer funziona su PGLite (community edition) — il vincolo PostgreSQL-only di v3.3 potrebbe essere rilassato dopo ulteriori test. PGLite supporta FOR UPDATE SKIP LOCKED, ON CONFLICT RETURNING, bigint.
- Replay semantics: turn-log con status='finalized' può ritornare cached result; status='prepared' con lease valido → lock conflict; status='compensated' → error al client.
- Pre-resolvers riducono il load sul LLM: cancel keywords + pending resolve deterministic catturano ~10-15% dei turni senza LLM call.
