import type { TaskMetadata } from '../tools/fetchTask';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WorkerPromptParams {
  instructions: string;
  taskContent: string;
  taskId: string;
  iteration: number;
  reportPath: string;
  metadata: TaskMetadata | null;
}

// ============================================================================
// Helpers
// ============================================================================

export const PREFLIGHT_IDEMPOTENCY_INSTRUCTION = `## Pre-flight: idempotency check

Before doing any work, inspect the current codebase against the task below.
This task may have been completed under a different ID in a previous run.

If the task body contains an "Acceptance Criteria" section, probe each
criterion against the current state. If it contains a "Touches" section,
inspect those files/modules for prior implementation. Otherwise reason from
the task description as a whole.

If you judge the work is already in place, do NOT redo it. Write your report
to the report path with the heading "No-op: already complete" followed by a
short evidence summary (which criteria are satisfied, which files contain
the implementation, any caveats). Then exit.

If the work is not yet done, or you are unsure, proceed with the task
normally. When in doubt, do the work — a redundant pass surfaces in human
review, but a false skip silently drops a task.

---

`;

const REPORT_STRUCTURE_GUIDE = `Write the report at the path named below using
this structure (matches \`docs/templates/WORKER_REPORT_TEMPLATE.md\`):

\`\`\`
---
model: <AI model name>
prd-source: <path relative to project root>
date: YYYY-MM-DD
status: red | green
---

# Worker Report: <feature-slug>

## Executive Summary

<2-5 sentences. What was attempted, what landed, what didn't, and the
recommended decision (greenlight or redlight).>

## Implementation

*What you actually did.*

- <action / change>

## Files Touched

*Created, modified, or deleted in this iteration.*

- \`path/to/file\` — <one-line summary>

## Acceptance Criteria Status

*Mirror each criterion from the task's \`## Acceptance Criteria\`. Drop this
section if the task did not declare criteria.*

- **<criterion>** — met | unmet | partial — <one-line evidence>

## Locked-in Decisions

*Decisions you made when the spec did not resolve a choice you faced. Each
entry: the gap, the call, and the reasoning.*

- **<decision>** — Spec did not specify <X>. Worker chose <Y> because
  <reason>.

## Open Questions

*Deviations from the spec, ambiguities, or anything to flag for the human
reviewer. Leave genuinely open — do not propose tentative answers.*

Q1: <question>?

## Appendix A: Worker's Narrative

*First-person account in a precise, behavioral register. Stay grounded in
what you actually did and decided. Do not claim interior experience (no
"felt", "noticed", "sensed").*

<narrative>
\`\`\``;

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Builds the single user message the worker sends to the Claude Agent SDK.
 *
 * @remarks
 * `reportPath` must be an absolute path so the worker writes to the
 * canonical reports directory regardless of any cwd shifts during task
 * execution; it is the exact path `commitTask` verifies against.
 * When `metadata.idempotency_check` is true the
 * `PREFLIGHT_IDEMPOTENCY_INSTRUCTION` block is prepended verbatim.
 */
export function buildWorkerPrompt(params: WorkerPromptParams): string {
  const preflight = params.metadata?.idempotency_check
    ? PREFLIGHT_IDEMPOTENCY_INSTRUCTION
    : '';
  return `${preflight}${params.instructions}

## Task (${params.taskId})

${params.taskContent}

---

When you are done, write a factual report to \`${params.reportPath}\` describing what you did and any deviations from the task spec.

${REPORT_STRUCTURE_GUIDE}`;
}
