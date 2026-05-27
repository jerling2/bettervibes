# BetterVibes — Project Conventions

This project uses BetterVibes for human-reviewed, task-based code
orchestration. Tasks are written by humans (or generated from PRDs), worked
by an Agent SDK worker subprocess, reviewed at each iteration, and either
greenlit or redlit by the reviewer.

## Layout

`bv_orchestration/` is this project's BetterVibes root. Everything BV
touches lives under it.

```
bv_orchestration/
├── tasks/
│   ├── new/                                  # tasks waiting to run
│   │   └── T-NN-YYYY-MM-DD.md
│   ├── stage/                                # tasks in flight (one or more worker reports attached, awaiting greenlight)
│   │   └── T-NN-YYYY-MM-DD.md
│   └── done/                                 # greenlit tasks
│       └── T-NN-YYYY-MM-DD.md
├── logs/
│   └── worker-reports/                       # every worker report ever produced, red and green
│       └── WR-NN-<feature-slug>-YYYY-MM-DD.md
└── checkpoint.sqlite                         # LangGraph runtime state (gitignored)
```

## Task lifecycle

A task has one location at a time. It can accumulate multiple worker reports
(1:M).

1. **new** — task spec is written to `tasks/new/`.
2. **stage** — `bettervibes run T-NN` moves the task to `tasks/stage/`,
   delegates to a worker, and produces a worker report under
   `logs/worker-reports/`. The task's `worker-reports` frontmatter array
   accumulates a reference to each report.
3. **done** — on greenlight, the orchestrator moves the task to
   `tasks/done/`. Reports stay in `logs/worker-reports/` regardless of
   color.

A redlight does not move the task; it stays in `stage/` and the array grows
on the next run.

## Worker reports

Each iteration writes one report to `logs/worker-reports/WR-NN-<slug>-YYYY-MM-DD.md`
with this frontmatter:

```
---
model: <AI model name>
prd-source: <path relative to project root>
date: YYYY-MM-DD            # operator's local calendar date
self_assessment: red | green
---
```

`self_assessment` is the **worker's own recommendation** (`green` = recommend
greenlight, `red` = recommend redlight) — it is *not* the reviewer's verdict.
The reviewer's actual greenlight/redlight is recorded by where the task ends up
(`tasks/stage/` = redlit and awaiting another pass, `tasks/done/` = greenlit);
it is never written back into the report. So a report's `self_assessment: green`
does not mean the iteration was accepted — check the task's location for that.

## PRDs

Tasks reference their source PRD via the `prd-source` frontmatter field — a
filesystem path relative to project root. The PRD location convention is up
to the project; a common shape is `docs/prds/PRD-NN-<slug>-v<n>.md`.

## CLI

- `bettervibes init` — create `bv_orchestration/` (refuses if already
  initialized in cwd or any ancestor)
- `bettervibes run <T-NN>` — start a task
- `bettervibes resume` — resume after a `human_review` interrupt; pipe a
  decision JSON on stdin (`{"decision":"greenlight"}` /
  `{"decision":"redlight","feedback":"..."}` /
  `{"decision":"clarify","answer":"..."}`)

Pass `--project-root <path>` to any command to operate on a project from
outside its tree. Otherwise BV walks up from cwd looking for
`bv_orchestration/` and fails loud if none is found.

## Authentication

BV uses the Claude Agent SDK, which reads `CLAUDE_CODE_OAUTH_TOKEN` from the
environment.
