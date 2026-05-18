---
author: Joseph
date: 2026-05-07
title: quick_start_guide.md
---

# BetterVibes Quick Start Guide

BetterVibes is a LangGraph-based orchestration CLI that coordinates Claude
Code workers under human review on a filesystem task queue. It runs against
your Claude Max subscription via the Agent SDK — no API billing. Per-project
state lives under a `bv_orchestration/` directory at the consumer project's
root.

This guide walks through a fresh install and a first run inside a consumer
project. See [`docs/prds/PRD-orchestration-v1.md`](./docs/prds/PRD-orchestration-v1.md)
for architectural details.

---

## 1. Install (once per machine)

Inside the BetterVibes source tree:

```bash
cd ~/Projects/BetterVibes
npm install        # pulls deps if they aren't already there
npm run build      # compiles to dist/ and chmods the bin
npm link           # registers `bettervibes` as a global symlink
```

After this, `bettervibes` is on your `PATH` from any directory. Verify:

```bash
which bettervibes
# → /Users/<you>/.nvm/.../bin/bettervibes (or similar)
```

Also confirm your OAuth token is exported (same token Claude Code uses):

```bash
echo "${CLAUDE_CODE_OAUTH_TOKEN:0:15}"
# → sk-ant-oat01-…
```

If that prints empty, see the "Authentication" section at the bottom.

---

## 2. Per-project setup

Per-project setup is a single explicit step. From the consumer project root:

```bash
cd <consumer-project>
bettervibes init
```

`bettervibes init` creates `bv_orchestration/` and its subdirectories, plus
a `BETTER_VIBES.md` conventions document copied verbatim from BV source. It
does **not** create `checkpoint.sqlite` — `SqliteSaver` lazily creates that
on the first `bettervibes run`.

Resulting tree:

```
<your-project>/
└── bv_orchestration/
    ├── BETTER_VIBES.md           # project conventions, committed
    ├── tasks/
    │   ├── new/                  # task specs waiting to run
    │   ├── stage/                # in-flight tasks (one or more reports attached)
    │   └── done/                 # greenlit tasks
    └── logs/
        └── worker-reports/       # every worker report ever produced (red and green)
```

`init` refuses if `bv_orchestration/` already exists in cwd or any ancestor:

```
fatal: already initialized at <path>
```

Use the existing project rather than creating a nested one.

Add a single line to the project's `.gitignore`:

```
bv_orchestration/checkpoint.sqlite
```

Tasks, worker reports, and `BETTER_VIBES.md` are durable artifacts and
should be committed. The checkpoint is per-developer runtime state and
should not be.

---

## 3. Running a task

### Authoring a task

Write a task spec at
`bv_orchestration/tasks/new/T-NN-YYYY-MM-DD.md`. The filename schema is
fixed: `T-NN` is a sequential id (`T-01`, `T-02`, …) and the date is the
authoring date. See `docs/templates/TASK_TEMPLATE.md` for the full
template. Example:

```markdown
---
author: Joseph, as told to Claude Opus 4.7
date: 2026-05-07
prd-source: docs/prds/PRD-orchestration-v1.md
worker-reports: []
status: new
idempotency_check: false
---

# Task: hello

Create `hello.txt` in the project root containing the single line
`hello bettervibes`. Report what you did.

## Acceptance Criteria

- `hello.txt` exists at the project root.
- The file's contents are exactly `hello bettervibes\n`.

## Touches

- `hello.txt`
```

The H1 (`# Task: <name>`) is load-bearing — the worker report's filename
slug is derived from it (lowercased, non-alphanumeric runs collapsed to
single hyphens). For this task, reports will be named like
`WR-01-hello-2026-05-07.md`.

### Invoking the runner

From anywhere inside the project tree, run:

```bash
bettervibes run T-01
```

`bettervibes` walks up from cwd looking for `bv_orchestration/`, with
closest-ancestor-wins semantics. If no marker is found, it fails loud:

```
fatal: not a bettervibes project
no `bv_orchestration/` found in <cwd> or any parent directory
run `bettervibes init` to create one, or pass --project-root <path>
```

To target a specific project from outside its tree (scripts, wrapper
agents, multi-project flows), pass `--project-root <path>` as a global
flag on any subcommand.

To pass extra context to the orchestrator on a single run — for example,
a spec the worker should follow — append `--include <path…>`:

```bash
bettervibes run T-02 --include docs/specs/auth.spec.v1.md
```

`--include` paths resolve against the resolved project root (not raw
cwd). ENOENT fails loud as `Include file not found: <path>`. The
orchestrator sees each file rendered as a `<file path="…">…</file>`
block.

### Task lifecycle

```
new → stage → done
        ↑       (greenlight moves the task spec; reports never move)
        └── stays here on redlight; worker-reports array grows
```

On first run, `fetchTaskNode` moves the task spec from
`tasks/new/T-NN-*.md` to `tasks/stage/` and flips its `status`
frontmatter from `new` to `stage`. Each worker iteration writes a fresh
report at `bv_orchestration/logs/worker-reports/WR-NN-<slug>-YYYY-MM-DD.md`
and appends the new `WR-NN` reference to the task's `worker-reports`
frontmatter array.

On greenlight, `pushTaskNode` moves the task spec from `tasks/stage/` to
`tasks/done/` and flips `status` to `done`. **Reports do not move.** They
live permanently in `logs/worker-reports/` regardless of color, providing
a complete audit trail.

On redlight, the task spec stays in `tasks/stage/`; the next run produces
another `WR-NN` appended to the array.

### Wire events

The CLI streams newline-delimited JSON on stdout. Two event tiers:

- **Coarse events** — `human_review`, `clarify`, `done`, or
  `no_active_task`. These end the current CLI invocation. The process
  exits; you resume separately.
- **Fine events** — `permission_request` during the worker's run.
  Answer by writing a `permission_response` JSON line to stdin without
  exiting.

Happy-path wire events:

```json
{"kind":"permission_request","request_id":"…","tool":"Write","args":{…},"task_id":"T-01","iteration":1}
{"status":"interrupted","interrupt":"human_review","task_id":"T-01","iteration":1,"report_path":"bv_orchestration/logs/worker-reports/WR-01-hello-2026-05-07.md"}
```

If you run `bettervibes resume` with no pending interrupt — for example,
after the previous task already greenlit — the CLI emits
`{"status":"no_active_task","message":"…"}` and exits 2 instead of
invoking the graph.

### Reviewing and resuming

Read the worker report at the emitted `report_path`. If it looks good,
greenlight:

```bash
echo '{"decision":"greenlight"}' | bettervibes resume
# → {"status":"done","task_id":"T-01","iterations":1}
```

If it's off, redlight with feedback — the orchestrator will re-delegate:

```bash
echo '{"decision":"redlight","feedback":"<specific reason>"}' | bettervibes resume
```

If the orchestrator emitted a `clarify` interrupt instead, answer it:

```bash
echo '{"decision":"clarify","answer":"<text>"}' | bettervibes resume
```

After greenlight, BetterVibes moves the task spec from `tasks/stage/` to
`tasks/done/` and clears the orchestrator's checkpoint thread so the next
`bettervibes run` starts on a fresh state. Don't move task spec files
between `stage/` and `done/` by hand — the next greenlight will fail with
`push target exists` (see §6).

**Exit codes:** `0` on a coarse interrupt or successful `done`; `1` on a
runtime error; `2` on an argv or stdin protocol error, on
`no_active_task`, or on a fatal `init` failure (target missing, already
initialized, or no marker found for `run`/`resume`).

### Pre-flight idempotency check (opt-in)

Tasks generated from a regenerated upstream spec may describe work
already done under a different ID in a prior run. Set
`idempotency_check: true` in the task's frontmatter to ask the worker to
probe the codebase first and, if the work is already in place, write a
"No-op: already complete" report instead of redoing it. The report still
flows through the normal `human_review` path — you greenlight it just
like any other report, and the task lands in `tasks/done/` as
documentation that it was considered.

```markdown
---
author: Joseph, as told to Claude Opus 4.7
date: 2026-05-07
prd-source: docs/prds/PRD-orchestration-v1.md
worker-reports: []
status: new
idempotency_check: true
---

# Task: add-auth

## Acceptance Criteria
- `POST /login` returns a signed JWT on valid credentials.
- Invalid credentials return 401 without leaking which field was wrong.

## Touches
- `src/auth/login.ts`
- `src/auth/jwt.ts`

## Spec Sections
- §4.1 (auth)
```

The worker reads `## Acceptance Criteria` and `## Touches` sections by
convention when present — neither is required, and the section names are
not parsed mechanically. When in doubt, the worker proceeds with the
task: a redundant pass surfaces in human review, but a false skip
silently drops work.

### Verifying before greenlight

The worker can write tests without running them, claim a suite passes
without executing it, and invent passing acceptance criteria. A worker
report is whatever the worker *said* happened — not necessarily what
did. Verify on the human-review side before greenlighting, where you
have hands on the keyboard. Telling the worker to run tests itself just
trusts the worker to follow that instruction; the human-review
checkpoint is the one place that cannot be deceived.

Run verification if any of these signals appear in the report at
`bv_orchestration/logs/worker-reports/WR-NN-<slug>-YYYY-MM-DD.md` or in
the changed files:

- new or modified test files (`*.test.ts`, `*.spec.ts`, `__tests__/`
  additions)
- new or modified dependencies in `package.json`
- the report claims "tests pass", "all passing", or "verified"
- a new package directory was created (e.g. a new workspace)

Skip if none of those signals appear (docs-only, rules-only,
config-only tasks).

Inside each affected package:

```bash
npm install      # only if node_modules/ is missing
npm test         # always, when verification is required
```

If the package uses a different runner (Vitest, Bun test), use whatever
its own `test` script points at — don't invent commands.

- **Pass** → proceed to greenlight; mention you verified the suite ran
  clean.
- **Fail, or `npm install` errors** → don't greenlight. Surface the
  output, and either redlight with the failure as feedback or stop to
  fix manually.
- **No tests were actually written despite the report claiming
  coverage** → redlight, naming the gap.

### Resumption-from-stage caveat

If a worker run crashes after the task spec has been moved to
`tasks/stage/` (between `fetchTaskNode` and `commitTask`), a fresh
`bettervibes run T-NN` will fail with `Task not found` because
`fetchTaskNode` only fetches from `tasks/new/`. Manually move the spec
back to `tasks/new/` to retry. This is tracked in the PRD under
`# Must Solve Soon` — a future change will let `fetchTaskNode` resume
from `tasks/stage/` on a `T-NN` match.

---

## 4. Teach Claude Code about BetterVibes

With the new design, `bv_orchestration/BETTER_VIBES.md` is committed at
the project root. Claude Code can read it directly. Add a single
pointer to the consumer project's `.claude/CLAUDE.md`:

```markdown
## BetterVibes (task orchestration)

This project uses BetterVibes. Conventions live in
`bv_orchestration/BETTER_VIBES.md` — read that before invoking the CLI.

When the user asks to "run a task" or "start the orchestrator":

1. Confirm the `T-NN` id and that the spec exists at
   `bv_orchestration/tasks/new/T-NN-*.md`. Run `bettervibes run T-NN
   [--include <path…>]` from anywhere in the project tree — walk-up
   resolution handles cwd.
2. Run as a backgrounded process — `human_review` can sit for minutes
   or hours, so don't block the foreground.
3. Relay coarse events to the user in natural language:
   - `human_review` → read the report at the emitted `report_path` first
     (don't summarize from memory). If the staged work touches tests,
     dependencies, or claims a suite passes, run that suite yourself
     before greenlighting. Then summarize and ask greenlight/redlight.
   - `clarify` → relay the orchestrator's question and wait for the
     answer.
   - `done` → confirm completion.
   - `no_active_task` → tell the user there is nothing to resume;
     suggest `bettervibes run <T-NN>`.
4. For `permission_request` events, surface the tool + args to the user
   and relay their `allow` / `deny` / `allow_session` decision back on
   stdin.
5. Resume by piping a decision JSON to `bettervibes resume`:
   - Greenlight: `echo '{"decision":"greenlight"}' | bettervibes resume`
   - Redlight:   `echo '{"decision":"redlight","feedback":"<text>"}' | bettervibes resume`
   - Clarify:    `echo '{"decision":"clarify","answer":"<text>"}' | bettervibes resume`
```

The heavy lifting (layout, lifecycle, PRD references, CLI shape, auth)
lives in `bv_orchestration/BETTER_VIBES.md`. This pointer just tells
Claude Code to look there.

---

## 5. Authentication

`bettervibes` uses the Claude Agent SDK, which reads
`CLAUDE_CODE_OAUTH_TOKEN` from the environment. The recommended setup on
macOS is to source the token from Keychain via `~/.zshenv` (so
non-interactive subprocess shells see it too):

```bash
# ~/.zshenv
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  export CLAUDE_CODE_OAUTH_TOKEN=$(security find-generic-password -a "$USER" -s "CLAUDE_CODE_OAUTH_TOKEN" -w 2>/dev/null)
fi
```

The token itself comes from `claude setup-token` (long-lived,
non-interactive) or `claude login` (browser OAuth). Store in Keychain:

```bash
security add-generic-password -a "$USER" -s "CLAUDE_CODE_OAUTH_TOKEN" -w "<paste-token>" -U
```

---

## 6. Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `fatal: not a bettervibes project` | `bv_orchestration/` not found in cwd or any ancestor. Run `bettervibes init` or pass `--project-root <path>`. |
| `fatal: already initialized at <path>` | `bettervibes init` was run inside a directory that already has `bv_orchestration/` somewhere up the tree. Use the existing project. |
| `Task not found: …/tasks/new/T-NN-*.md` | Typo in `T-NN`, file not created, or the spec is sitting in `tasks/stage/` from a crashed run (see the resumption-from-stage caveat in §3). |
| SDK authentication error | `CLAUDE_CODE_OAUTH_TOKEN` empty — see §5. |
| Hangs after a `permission_request` | Worker is waiting for a `permission_response` on stdin; answer or deny. |
| `push target exists: …/tasks/done/T-NN-*.md` | Most often a stale `done/` entry from a manual `stage/` → `done/` move. With deterministic checkpoint clearing, an honest re-greenlight of the same iteration is unusual. Delete the stale `done/` entry before retrying. |
| `bettervibes: command not found` | `npm link` wasn't run, or `~/.npm-global/bin` (or nvm's bin) isn't on `PATH`. |
