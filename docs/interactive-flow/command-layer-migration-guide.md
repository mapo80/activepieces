# Command Layer — Migration Guide

How to migrate an existing INTERACTIVE_FLOW (e.g. `estinzione.json`) from the
legacy `fieldExtractor` path to the server-governed Command Layer.

For developer-facing reference (env, tooling, renderers) see
[command-layer-developer-guide.md](./command-layer-developer-guide.md).

## Pre-flight checklist

- Database is **PostgreSQL** or **PGLite** (`AP_DB_TYPE` must be one of these;
  publish-time validator rejects others).
- The flow's `stateFields` declare `extractable: true` for fields that the
  LLM should populate from user messages.
- Each `ANSWER_INFO` intent the flow needs is implemented as a renderer in
  `info-renderer.ts` and registered there.
- The bridge is reachable from the API (`curl -sf http://localhost:8787/health`)
  *or* you accept the default `MockProviderAdapter` for testing.
- Locales used by the flow are present in `packages/web/public/locales/<lang>/translation.json`.

## Step-by-step migration of estinzione.json

1. **Snapshot the legacy fixture** — capture a baseline run with
   `useCommandLayer: false` to compare bot output later (golden response set).
   Existing tests in `packages/server/api/test/integration/ce/ai/command-layer-benchmark.test.ts`
   provide reference snapshots for the most common scenarios.

2. **Open the fixture** under `fixtures/flow-templates/estinzione.json`. Locate
   the INTERACTIVE_FLOW step's `settings`.

3. **Add `useCommandLayer: true`** at the root of `settings`.

4. **Audit `stateFields`**. For each field the LLM is expected to extract,
   ensure `extractable: true` and a sensible `minLength` / `maxLength` /
   `format` constraint.

5. **Migrate question wording**. Move per-step Italian/English `message`
   strings into the relevant USER_INPUT node's `message` map. The post-DAG
   status renderer (`statusRenderer.render`) builds the bot reply from the
   final state — make sure the status message is well-formed for the locale.

6. **Add `infoIntents`** if the flow supports questions like "quanti
   rapporti", "che tipo è il rapporto X". List one entry per intent with the
   `renderer` field pointing to the function key registered in
   `info-renderer.ts`.

7. **Tighten the `systemPrompt`** to refer to domain concepts (account types,
   closure reasons) without enumerating the ConversationCommand schema. Keep
   it concise; the dynamic tools registry already exposes the JSON-Schema
   contract to the LLM.

8. **Validate the JSON** locally:

   ```bash
   cd packages/server/api && AP_EDITION=ce npm run test-unit -- \
     test/unit/app/flows/interactive-flow-validator.test.ts
   ```

   Then publish the flow via the admin UI. The validator returns 4xx if
   `useCommandLayer: true` is set and `AP_DB_TYPE` is not POSTGRES/PGLITE
   (i18n key `validation.commandLayer.requiresPostgres`).

9. **Run the integration suite** to confirm no behaviour regressed:

   ```bash
   cd packages/server/api && export $(cat .env.tests | xargs) && \
     AP_EDITION=ce npx vitest run test/integration/ce/ai/
   ```

10. **Smoke test in the chat drawer**. With
    `AP_LLM_VIA_BRIDGE=true` and a running bridge, exercise:
    - Field extraction (e.g. `Bellafronte`)
    - Meta-question (`cosa mi avevi chiesto?`)
    - Info-question (`quanti rapporti?`)
    - Cancel (`annulla` → confirmation → accept/reject)
    - Compound (`Rossi quanti rapporti ha?`)

## Validation

After migration, the following must all hold:

- The previously-captured baseline (step 1) golden responses still match for
  scenarios that don't exercise the new compound/info paths.
- New compound/info scenarios produce the expected `INTERACTIVE_FLOW_TURN_EVENT`
  WS frames (visible via browser devtools Network tab → WS).
- No `prepared` rows remain in `interactive_flow_turn_log` after a successful
  smoke run (all should reach `finalized`).
- `interactive_flow_outbox` has rows with `eventStatus = 'publishable'`
  during the run and `'pending'` only briefly between INSERT and
  `markPublishable`.

## Rollback procedure

If a migrated flow exhibits regressions in production:

1. **Revert per-flow** — set `useCommandLayer: false` in the flow's
   settings and re-publish. The legacy `fieldExtractor` chain takes over
   immediately on the next turn. Already-`prepared` turns will be reclaimed
   by the lock-recovery daemon as `compensated` after the configured
   `prepareStaleSeconds` window (default 300 s).

2. **Revert globally** — unset `AP_LLM_VIA_BRIDGE` to fall back to
   `MockProviderAdapter` for command layer. Useful only if the bridge or
   the LLM is the suspected fault, since flows with
   `useCommandLayer: true` will continue to use the server-governed path
   but with the mock provider (which only returns pre-registered commands).

3. **Revert at the schema level** — extreme case where the migrations need
   to be rolled back: follow the
   [Database Migrations Playbook](https://www.activepieces.com/docs/handbook/engineering/playbooks/database-migration)
   to revert the three command-layer migrations. Do not run on a live
   tenant — coordinate with the on-call engineer.

## Cross-flow validation

When migrating both `consultazione.json` and `estinzione.json`:

- Each flow has its own `infoIntents` registry; do not share renderer keys
  between flows unless the semantics genuinely match.
- Run the cross-flow benchmark to ensure the two fixtures produce distinct
  `stateDiff` signatures:

  ```bash
  AP_EDITION=ce npx vitest run \
    packages/server/api/test/integration/ce/ai/command-layer-benchmark.test.ts
  ```

- Legacy fixtures (`useCommandLayer: false`) must remain unchanged. The
  benchmark suite includes reference snapshots that gate this regression.
