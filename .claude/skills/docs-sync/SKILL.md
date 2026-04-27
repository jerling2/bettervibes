---
name: docs-sync
description: >-
  Keep README.md and quick_start_guide.md in sync with BetterVibes' public CLI
  surface (argv, stdin schemas, stdout/coarse-event schemas, exit codes).
  TRIGGER when: editing src/cli/runner.ts (argv parsing, exit codes,
  coarse-event emission), editing src/cli/schemas.ts (CliOutput,
  PermissionRequestEvent, PermissionResponseEvent, ResumeInput), editing or
  adding files under src/tools/ that introduce or change a CLI flag, or
  otherwise changing what bettervibes consumes on argv/stdin or emits on
  stdout/stderr/exit code. DO NOT TRIGGER when: editing graph nodes, prompts,
  the checkpointer internals, tests, or any file whose changes do not surface
  on the wire.
---

# Docs Sync

Keep the user-facing docs honest about what BetterVibes accepts and emits.
The package has two public docs — `README.md` and `quick_start_guide.md` —
plus an embedded `.claude/CLAUDE.md` snippet inside §4 of the quick-start
that consumers paste into their own projects. All three describe the CLI's
wire surface, so any change to that surface needs to land in the docs in the
same PR as the code change.

## When to Activate

Activate when a change touches one of the four observable surfaces the docs
describe:

- **argv** — `parseArgs` in `src/cli/runner.ts` (positional args, flags).
- **stdin schemas** — `ResumeInput`, `PermissionResponseEvent` in
  `src/cli/schemas.ts`.
- **stdout / coarse-event schemas** — `CliOutput`,
  `PermissionRequestEvent` in `src/cli/schemas.ts`.
- **exit codes** — return values from `runCli` in `src/cli/runner.ts`.

Doc anchors this skill is responsible for keeping in sync:

- `quick_start_guide.md` §3 — the `bettervibes run …` and
  `bettervibes resume` synopsis lines.
- `quick_start_guide.md` §3 — the wire-events bullets and JSON sample.
- `quick_start_guide.md` §3 — the exit-code summary.
- `quick_start_guide.md` §4 — the embedded `.claude/CLAUDE.md` snippet
  (consumers paste this verbatim into their projects, so it must mirror the
  real CLI exactly).
- `quick_start_guide.md` §6 — the troubleshooting table (any new failure
  modes that surface on stderr or as a non-0 exit).
- `README.md` — the tagline, only if the product framing itself changes.

**Do not use** when the change is internal-only — graph topology, prompt
text, checkpointer storage details, worker tool registration, tests, or any
refactor whose effect doesn't reach argv/stdin/stdout/exit codes.

## Workflow

1. Identify which surface(s) the change touches — argv, stdin schema,
   stdout schema, or exit code. If none, the skill should not have
   triggered; bail.
2. For each touched surface, list the doc anchors from "When to Activate"
   that reference it.
3. Re-read each anchor against the current source. Verify the *exact*
   claims — event names, JSON field names, error message strings, exit
   code numbers — by re-grepping the source. Don't trust memory.
4. Apply the minimum doc edit. Match surrounding voice; the quick-start
   uses imperative second-person and short paragraphs.
5. After edits, walk every code-claim cross-reference back to source one
   more time.

## Grep recipes

Sanity-check coverage with:

```bash
rg -n 'CliOutput|PermissionRequestEvent|PermissionResponseEvent|ResumeInput' src/cli/schemas.ts
rg -n 'parseArgs|return 1|return 2' src/cli/runner.ts
rg -n 'bettervibes run|bettervibes resume|--include|no_active_task|push target exists' quick_start_guide.md README.md
```

## Anti-Patterns

- **Redesigning doc structure**: this is a sync skill, not a redesign skill.
  Don't rearrange sections or invent new ones.
- **Editing the spec**: `docs/orchestration/orchestration.spec.v1.md` has
  its own change process via the `changelog-entry` skill. Append to the
  changelog instead of editing the spec.
- **Triggering on internal refactors**: graph topology, prompt content,
  checkpointer storage are not user-visible and not in scope.
- **Paraphrasing wire-format strings**: when the docs quote a JSON event,
  field name, or error message, copy it verbatim from source — a typo here
  silently breaks consumers.

## References

- `quick_start_guide.md` §3, §4, §6 — the anchors this skill maintains.
- `src/cli/runner.ts` — argv parsing, exit codes, coarse-event emission.
- `src/cli/schemas.ts` — wire schemas for both directions.
- `.claude/skills/changelog-entry/SKILL.md` — sibling skill for spec
  changes; route there if the change is conceptual rather than wire-level.
