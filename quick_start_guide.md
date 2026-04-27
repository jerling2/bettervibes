---
author: Joseph
date: 04-24-2026
title: quick_start_guide.md
---

# BetterVibes Quick Start Guide

BetterVibes is a LangGraph-based orchestration CLI that coordinates Claude
Code workers against a filesystem-based task queue, with a human-in-the-loop
review at each iteration. It runs against your Claude Max subscription via
the Agent SDK — no API billing.

This guide walks through a fresh install and a first run inside a consumer
project. See [`docs/orchestration/orchestration.spec.v1.md`](./docs/orchestration/orchestration.spec.v1.md)
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

In any consumer project, `bettervibes` auto-creates the directories it needs
on first invocation:

```
<your-project>/
├── tasks/
│   ├── ingest/       # you write task specs here
│   ├── staged/       # worker reports land here pending review
│   └── done/         # greenlit reports end up here
└── .bettervibes/
    └── checkpoint.sqlite   # graph state; gitignored
```

Add these two lines to the project's `.gitignore`:

```
.bettervibes/
tasks/staged/
```

Whether you commit `tasks/ingest/` and `tasks/done/` is up to you.

---

## 3. Running a task

Write a task spec at `tasks/ingest/<task-id>.md` — a markdown file with any
structure the worker should follow. Example:

```markdown
---
task_id: hello
---

# Task: hello

Create `hello.txt` in the project root containing the single line
`hello bettervibes`. Report what you did.
```

From the project root, run:

```bash
bettervibes run hello
```

To pass extra context to the orchestrator on a single run — for example, a
spec the worker should follow — append `--include <path…>`:

```bash
bettervibes run add-auth --include docs/specs/auth.spec.v1.md
```

Paths resolve against the project cwd. ENOENT fails loud with
`Include file not found: <path>` so a typo can't silently produce an
incomplete prompt. The orchestrator sees each file rendered as a
`<file path="…">…</file>` block.

The CLI streams newline-delimited JSON on stdout. Two event tiers:

- **Coarse events** — `human_review`, `clarify`, `done`, or `no_active_task`.
  These end the current CLI invocation. The process exits; you resume
  separately.
- **Fine events** — `permission_request` during the worker's run. Answer by
  writing a `permission_response` JSON line to stdin without exiting.

Happy-path wire events:

```json
{"kind":"permission_request","request_id":"…","tool":"Write","args":{…},"task_id":"hello","iteration":1}
{"status":"interrupted","interrupt":"human_review","task_id":"hello","iteration":1,"report_path":"tasks/staged/hello-01.md"}
```

If you run `bettervibes resume` with no pending interrupt — for example,
after the previous task already greenlit — the CLI emits
`{"status":"no_active_task","message":"…"}` and exits 2 instead of invoking
the graph.

Read the staged report. If it looks good, greenlight:

```bash
echo '{"decision":"greenlight"}' | bettervibes resume
# → {"status":"done","task_id":"hello","iterations":1}
```

If it's off, redlight with feedback — the orchestrator will re-delegate:

```bash
echo '{"decision":"redlight","feedback":"<specific reason>"}' | bettervibes resume
```

After greenlight, the report is moved from `tasks/staged/` to `tasks/done/`
and the orchestrator's checkpoint thread is cleared so the next
`bettervibes run` starts on a fresh state. Don't move files between
`staged/` and `done/` by hand — the next greenlight will fail with
`push target exists` (see §6).

**Exit codes:** `0` on a coarse interrupt or successful `done`; `1` on a
runtime error; `2` on an argv or stdin protocol error, or on
`no_active_task`.

### Pre-flight idempotency check (opt-in)

Tasks generated from a regenerated upstream spec may describe work already
done under a different ID in a prior run. Set `idempotency_check: true` in
the task's frontmatter to ask the worker to probe the codebase first and,
if the work is already in place, write a "No-op: already complete" report
instead of redoing it. The report still flows through the normal
`human_review` path — you greenlight it just like any other report, and it
lands in `tasks/done/` as documentation that the task was considered.

```markdown
---
task_id: add-auth
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
not parsed mechanically. When in doubt, the worker proceeds with the task:
a redundant pass surfaces in human review, but a false skip silently drops
work.

### Verifying before greenlight

The worker can write tests without running them, claim a suite passes
without executing it, and invent passing acceptance criteria. A staged
report is whatever the worker *said* happened — not necessarily what did.
Verify on the human-review side before greenlighting, where you have
hands on the keyboard. Telling the worker to run tests itself just trusts
the worker to follow that instruction; the human-review checkpoint is
the one place that cannot be deceived.

Run verification if any of these signals appear in the staged report or
the changed files:

- new or modified test files (`*.test.ts`, `*.spec.ts`, `__tests__/`
  additions)
- new or modified dependencies in `package.json`
- the report claims "tests pass", "all passing", or "verified"
- a new package directory was created (e.g. a new workspace)

Skip if none of those signals appear (docs-only, rules-only, config-only
tasks).

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
- **No tests were actually written despite the report claiming coverage**
  → redlight, naming the gap.

---

## 4. Teach Claude Code about BetterVibes

Add a section to the consumer project's `.claude/CLAUDE.md` so Claude Code
knows when and how to invoke `bettervibes`. Paste this in:

```markdown
## BetterVibes (task orchestration)

This project uses the `bettervibes` CLI for long-running, human-reviewed
task workflows. Task specs live in `tasks/ingest/<task-id>.md`; worker
reports accumulate in `tasks/staged/` and, after greenlight, `tasks/done/`.

When the user asks to "run a task" or "start the orchestrator":

1. Confirm the task id and that `tasks/ingest/<task-id>.md` exists. Always
   invoke `bettervibes` from the project root — `bettervibes run` and
   `bettervibes resume` resolve `.bettervibes/checkpoint.sqlite` and
   `tasks/` against cwd, so a subdir invocation creates a stub checkpoint
   in the wrong place and `resume` returns `no_active_task`.
2. Run `bettervibes run <task-id> [--include <path…>]` as a backgrounded
   process — `human_review` can sit for minutes or hours, so don't block
   the foreground. Only pass `--include` when the user has named extra
   context files for this run.
3. Relay coarse events to the user in natural language:
   - `human_review` → read the report at the emitted `report_path` first
     (don't summarize from memory). If the staged work touches tests,
     dependencies, or claims a suite passes, run that suite yourself
     before greenlighting — workers can claim tests pass without running
     them. Then summarize and ask greenlight/redlight.
   - `clarify` → relay the orchestrator's question and wait for the answer.
   - `done` → confirm completion.
   - `no_active_task` → tell the user there is nothing to resume; suggest
     `bettervibes run <task-id>`.
4. For `permission_request` events during the run, surface the tool + args
   to the user and relay their `allow` / `deny` / `allow_session` decision
   back on stdin.
5. Resume by piping a decision JSON to `bettervibes resume`:
   - Greenlight: `echo '{"decision":"greenlight"}' | bettervibes resume`
   - Redlight:   `echo '{"decision":"redlight","feedback":"<text>"}' | bettervibes resume`
   - Clarify:    `echo '{"decision":"clarify","answer":"<text>"}' | bettervibes resume`

After a `human_review` greenlight, BetterVibes itself moves the report from
`tasks/staged/` to `tasks/done/` and clears its checkpoint. Do not move
files between those folders by hand — a manual move will collide with the
next greenlight as `push target exists`.

State is persisted in `.bettervibes/checkpoint.sqlite` and is cleared
automatically after each greenlight. Deleting `.bettervibes/` is only needed
as an escape hatch for a stuck thread.
```

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

The token itself comes from `claude setup-token` (long-lived, non-interactive)
or `claude login` (browser OAuth). Store in Keychain:

```bash
security add-generic-password -a "$USER" -s "CLAUDE_CODE_OAUTH_TOKEN" -w "<paste-token>" -U
```

---

## 6. Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `Task not found: …/tasks/ingest/<id>.md` | Typo in task-id or file not created. |
| SDK authentication error | `CLAUDE_CODE_OAUTH_TOKEN` empty — see §5. |
| Hangs after a `permission_request` | Worker is waiting for a `permission_response` on stdin; answer or deny. |
| `push target exists: …/tasks/done/<id>-01.md` | Most often a stale `done/` entry from a manual `staged/` → `done/` move. With deterministic checkpoint clearing, an honest re-greenlight of the same iteration is unusual. Delete the stale `done/` entry before retrying. |
| `bettervibes: command not found` | `npm link` wasn't run, or `~/.npm-global/bin` (or nvm's bin) isn't on `PATH`. |
