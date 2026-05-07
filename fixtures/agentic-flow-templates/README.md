# Agentic flow templates

Queste fixture espongono i flow ActivePieces della piattaforma agentica in una forma leggibile/importabile per review del designer.

La sorgente di verita' non e' questa directory e non e' un campo AP salvato nel bundle: i flow sono generati dai `CapabilityBundle` del repository `agentic-workflow-platform` a partire da `workflow.canonical`.

## Flow inclusi

- `banking-account-closure.ap-flow.json`: estinzione rapporti.
- `pa-gaia-commons.ap-flow.json`: GAIA-Commons dimostrativo.

## Rigenerazione

Dal root di `activepieces-fork2`:

```bash
./scripts/sync-agentic-flow-templates.sh
```

Per usare un checkout della piattaforma in un path diverso:

```bash
AGENTIC_PLATFORM_DIR=/path/to/agentic-workflow-platform ./scripts/sync-agentic-flow-templates.sh
```

Il comando chiama il compiler Java della piattaforma (`BundleApFlowExportMain`) e valida che l'artifact generato sia tenant-neutral, senza `projectId`, con `metadata.sourceOfTruth=workflow.canonical`.

Prerequisiti locali: `mvn` e `jq`.

## Regola architetturale

ActivePieces resta designer/runtime provider. Intent, LLM, policy, cataloghi tool e contratto dati restano nella piattaforma agentica.
