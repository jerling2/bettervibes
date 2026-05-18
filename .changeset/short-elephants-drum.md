---
'bettervibes': minor
---

Add `bettervibes update` subcommand to refresh BV-shipped files inside a
consumer project's `bv_orchestration/` without touching consumer data.
Introduces `src/manifest.ts` as the single source of truth for what BV
ships; `init` is refactored to iterate the same manifest. Both `init` and
`update` now write a `bv_orchestration/.bvversion` stamp. `update`
supports `--dry-run`. See PRD-update-protocol-v1 for full behavior.
