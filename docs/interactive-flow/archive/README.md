# Storico INTERACTIVE_FLOW — fallback rimosso il 2026-04-26

Questi documenti descrivono **stadi intermedi** del progetto INTERACTIVE_FLOW, quando coesistevano due implementazioni del runtime (command layer + legacy field-extractor) selezionate dal flag `settings.useCommandLayer`.

Il fallback legacy è stato **rimosso completamente** il 2026-04-26 — il command layer è ora il runtime unico. Lo schema `useCommandLayer` non esiste più.

I file qui presenti sono mantenuti come riferimento storico del processo decisionale e architetturale, **non sono normativi**. Per la documentazione corrente vedi:

- [../command-layer-developer-guide.md](../command-layer-developer-guide.md) — guida sviluppatore aggiornata
- [../architecture-command-layer-vs-previous.md](../architecture-command-layer-vs-previous.md) — confronto architetturale + sezione "fallback rimosso"
- [../progress-log.md](../progress-log.md) — log cronologico

## Indice

| File | Tipo | Periodo |
|---|---|---|
| `solution-final-v2.md`, `v3.md`, `v3.1.md`, `v3.2.md`, `v3.3.md` | Iterazioni di design | 2026-Q1 |
| `solution-final-review.md` | Review v1 della proposta | 2026-Q1 |
| `current-vs-proposed.md` | Confronto legacy vs Modo 3 | 2026-Q1 |
| `proposals-comparison.md` | 25 scenari × 3 proposte | 2026-Q1 |
| `solution-patterns.md` | 5 "Modi" tecnici | 2026-Q1 |
| `closure-plan.md`, `deviations-closure-plan.md`, `implementation-plan-v3.3.md` | Piani esecutivi completati | 2026-Q1/Q2 |
| `canary-rollout-plan.md` | Rollout per-flow (semantica obsoleta dopo rimozione) | 2026-Q2 |
| `spike-0a-report.md` | Spike SQL/concurrency | 2026-Q2 |
