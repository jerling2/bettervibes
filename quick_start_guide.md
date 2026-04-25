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
project. See `docs/orchestration/orchestration.spec.v1.md` in the original
ArchIT repo for architectural details.

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

The CLI streams newline-delimited JSON on stdout. Two event tiers:

- **Coarse events** — `human_review`, `clarify`, or `done`. These end the
  current CLI invocation. The process exits; you resume separately.
- **Fine events** — `permission_request` during the worker's run. Answer by
  writing a `permission_response` JSON line to stdin without exiting.

Happy-path wire events:

```json
{"kind":"permission_request","request_id":"…","tool":"Write","args":{…},"task_id":"hello","iteration":1}
{"status":"interrupted","interrupt":"human_review","task_id":"hello","iteration":1,"report_path":"tasks/staged/hello-01.md"}
```

Read the staged report. If it looks good, greenlight:

```bash
echo '{"decision":"greenlight"}' | bettervibes resume
# → {"status":"done","task_id":"hello","iterations":1}
```

If it's off, redlight with feedback — the orchestrator will re-delegate:

```bash
echo '{"decision":"redlight","feedback":"<specific reason>"}' | bettervibes resume
```

After greenlight, the report moves from `tasks/staged/` to `tasks/done/`.

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

1. Confirm the task id and that `tasks/ingest/<task-id>.md` exists.
2. Run `bettervibes run <task-id>`.
3. Relay coarse events to the user in natural language:
   - `human_review` → summarize the staged report and ask greenlight/redlight.
   - `clarify` → relay the orchestrator's question and wait for the answer.
   - `done` → confirm completion.
4. For `permission_request` events during the run, surface the tool + args
   to the user and relay their `allow` / `deny` / `allow_session` decision
   back on stdin.
5. Resume by piping a decision JSON to `bettervibes resume`:
   - Greenlight: `echo '{"decision":"greenlight"}' | bettervibes resume`
   - Redlight:   `echo '{"decision":"redlight","feedback":"<text>"}' | bettervibes resume`
   - Clarify:    `echo '{"decision":"clarify","answer":"<text>"}' | bettervibes resume`

State is persisted in `.bettervibes/checkpoint.sqlite`. To reset a stuck
thread, delete `.bettervibes/`.
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
| `push target exists: …/tasks/done/<id>-01.md` | Prior greenlight closed the same task-iteration. Move or delete the old `done/` entry before retrying. |
| `bettervibes: command not found` | `npm link` wasn't run, or `~/.npm-global/bin` (or nvm's bin) isn't on `PATH`. |
