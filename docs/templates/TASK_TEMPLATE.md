---
author: <"Joseph, as told to <AI-Model>" | "<AI-Model>, from <prd-source>">
date: YYYY-MM-DD
prd-source: <path relative to project root, e.g., docs/prds/PRD-NN-<slug>-v1.md>
worker-reports: []
status: new | stage | done
idempotency_check: true
---

# Task: <slug>

<One-paragraph description of what the task is and why. Reads like a
self-contained brief — a worker can act on this without external context
beyond the PRD reference.>

## Acceptance Criteria

*Optional. Concrete, verifiable conditions. The worker reports against these
in `## Acceptance Criteria Status` in its report.*

- <criterion>
- <criterion>

## Touches

*Optional. Files or modules expected to change.*

- `path/to/file.ts`
- `path/to/another.ts`

## Spec Sections

*Optional. PRD section references.*

- §<n.m> (<slug>)
