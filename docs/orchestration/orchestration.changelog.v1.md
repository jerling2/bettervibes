---
name: orchestration.changelog.v1
created: 2026-04-24
---

# Orchestration Changelog for V1

The changelog is an extension of the specifications; together they form the "true specification". Write your questions, corrections, or additions here. Do not edit the specification file on your own.

| Reference | Purpose |
| ---------- | ------- |
| [README.md](../guidelines/README.md) | Documentation Workflow |
| [CHANGELOG_TEMPLATE.md](../guidelines/CHANGELOG_TEMPLATE.md) | Changelog Contribution |

# Changelog

## 2026-04-24: Joseph

Migrated the orchestration code out of ArchIT's `packages/langgraph/` into a standalone project named `BetterVibes`. The package no longer belongs only to ArchIT — `bettervibes` is now a globally-installable CLI that can drive a task pipeline in any consumer project. This spec file was carried over from ArchIT's `docs/orchestration/orchestration.spec.v1.md` and adjusted to reflect the new deployment shape.

Concrete changes vs. what the v1 spec described before the migration:

- **CLI name and identifiers.** `archit` → `bettervibes` throughout. The MCP server is now `bettervibes-orchestrator`; the fixed `thread_id` is `bettervibes-main`; the internal graph builder is `buildBetterVibesGraph`.
- **Path rooting (§1.2, §2, §3.2).** The four `__dirname`-rooted path constants (`INGEST_DIR`, `STAGED_DIR` in both `commitTask.ts` and `pushTask.ts`, `DONE_DIR`, and `CHECKPOINT_PATH`) now resolve from `process.cwd()`. The worker's SDK `cwd` option does too — the `REPO_ROOT` constant in `worker.ts` is gone. Task directories (`tasks/ingest/`, `tasks/staged/`, `tasks/done/`) and the checkpoint (`.bettervibes/checkpoint.sqlite`) live in each consumer project's cwd, not in this package. The CLI creates all four directories on startup if missing.
- **Worker prompt report path (§3.2).** The trailing directive named `packages/langgraph/src/tasks/staged/{task_id}-{iteration}.md`. Now names `tasks/staged/{task_id}-{iteration}.md`. Caught as a bug during the extraction smoke — the initial run wrote its report to a nested `./packages/langgraph/src/tasks/staged/` under the consumer cwd before this fix landed.
- **Build step.** Previously the CLI shipped as a `ts-node` shebang. Now compiles to `dist/cli/bettervibes.js` via `npm run build` (runs `tsc` + `chmod +x`); `bin.bettervibes` in `package.json` points at the compiled output. Consumers install via `npm link` from the BetterVibes source tree.
- **Claude Code integration shape (§1.2, §7.3).** Was a dedicated skill at `.claude/skills/archit-orchestrator/SKILL.md` inside the ArchIT repo. Is now a snippet template in `quick_start_guide.md` that consumers paste into their own project's `.claude/CLAUDE.md`. §7.3's "write a Claude Code skill" direction is retroactively closed by this.
- **§2 file structure.** Re-rooted from `packages/langgraph/` to `bettervibes/`. The `tasks/` subdir is no longer listed inside the tree (lives in consumer cwd). Added `docs/`, `quick_start_guide.md`, and `jest.config.json`. Added a notes bullet explaining the cwd rebase.

Still internally inconsistent, flagged here instead of patched in the spec:

- §1.2 decision "Dedicated `bettervibes` package in the monorepo" reads as vestigial now that BetterVibes is standalone. The rationale ("orchestration logic is application code, not `.claude/` config") still applies, but the "in the monorepo" framing is stale.
- Two mentions of `@bettervibes/shared` (carried over from the original `@archit/shared`) reference a workspace package that doesn't exist. Harmless as forward-looking guidance, but confusing without context.

End-to-end smoke was verified from `~/tmp/bettervibes-smoke/` — fresh scratch dir with a trivial hello-world task, clean `human_review` → greenlight → `done` with zero permission prompts.
