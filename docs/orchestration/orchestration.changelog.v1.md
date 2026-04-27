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

## 2026-04-27: Joseph

Two features and one event have shipped on top of the v1 spec since the 2026-04-24 migration. Logging here so the next monthly merge folds them into the spec proper, and so today's docs refresh of `quick_start_guide.md` and `README.md` has a single source of truth to point at.

- **`--include <path…>` flag on `bettervibes run` (§4.4 CLI Contract).** The synopsis in §4.4 reads `bettervibes run <task-id>`; the implementation now also accepts `--include <path1> [<path2> …]`. Paths resolve against the consumer project's cwd, ENOENT fails loud as `Include file not found: <path>`, and each resolved file is rendered into the orchestrator prompt as a `<file path="…">…</file>` block. Source: `src/cli/runner.ts:68-86` (parseArgs), `src/tools/includeFiles.ts`. Motivation: pass spec or design-doc context the orchestrator should see on a single run without polluting the task spec itself.

- **Deterministic checkpoint clearing on greenlight (§1.2 decisions, §4.2 control flow).** §1.2 currently says "To start fresh, delete the checkpoint file." That's now an escape hatch only — the happy path self-cleans. After a `human_review` greenlight reaches END (graph path: `human_review → greenlight → push_task → END`), the runner calls `clearThread(checkpointer, THREAD_ID)` so the next `bettervibes run` begins on an empty thread instead of accumulating messages across tasks. Source: `src/cli/runner.ts:505-516`, `src/checkpointer.ts`. Implication for §6 troubleshooting wording: `push target exists` is now almost always a stale `done/` entry from a manual move, not a re-greenlight of the same iteration.

- **`no_active_task` coarse event (§4.4 `CliOutput`).** §4.4 defines `CliOutput` as a discriminated union over three statuses (`interrupted` with two interrupt sub-shapes, and `done`). A fourth status, `no_active_task`, is now emitted when `bettervibes resume` runs against a thread with no pending interrupt — exits 2 with `{"status":"no_active_task","message":"…"}` on stdout instead of invoking the graph. Source: `src/cli/schemas.ts:91-94` (schema), `src/cli/runner.ts:368-378` (emission). Motivation: distinguish "nothing to resume" from a successful no-op `done`, which the previous behavior conflated.

Not flagged here because they're already in the spec or already correct: the opt-in `idempotency_check` frontmatter (`src/prompts/worker.ts`), authentication setup, and §2 directory layout.
