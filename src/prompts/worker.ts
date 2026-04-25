import { formatReportFilename } from '../tools/commitTask';
import type { TaskMetadata } from '../tools/fetchTask';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WorkerPromptParams {
  instructions: string;
  taskContent: string;
  taskId: string;
  iteration: number;
  metadata: TaskMetadata | null;
}

// ============================================================================
// Helpers
// ============================================================================

const STAGED_DIR_REL = 'tasks/staged';

/**
 * Pre-flight idempotency check prepended to the worker prompt when the task's
 * frontmatter sets `idempotency_check: true`.
 *
 * @remarks
 * Lets the worker close out a regenerated task whose work is already in place
 * (under a different ID from a prior run) without redoing it. The "No-op"
 * report still flows through `human_review` — the heading is a convention for
 * the reviewer, not a parsed signal. False-skip is more dangerous than
 * redundant work, so the instruction biases toward doing the work when in
 * doubt.
 */
export const PREFLIGHT_IDEMPOTENCY_INSTRUCTION = `## Pre-flight: idempotency check

Before doing any work, inspect the current codebase against the task below.
This task may have been completed under a different ID in a previous run.

If the task body contains an "Acceptance criteria" section, probe each
criterion against the current state. If it contains a "Touches" section,
inspect those files/modules for prior implementation. Otherwise reason from
the task description as a whole.

If you judge the work is already in place, do NOT redo it. Write your report
to the staged path with the heading "No-op: already complete" followed by a
short evidence summary (which criteria are satisfied, which files contain
the implementation, any caveats). Then exit.

If the work is not yet done, or you are unsure, proceed with the task
normally. When in doubt, do the work — a redundant pass surfaces in human
review, but a false skip silently drops a task.

---

`;

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Builds the single user message the worker sends to the Claude Agent SDK.
 *
 * @param params - Orchestrator-supplied instructions, the raw task content,
 *   the task_id, the current iteration, and parsed task metadata. The task_id
 *   and iteration drive the report path, which must match what `commitTask`
 *   validates against. Metadata may be null on legacy paths; only
 *   `idempotency_check === true` alters the prompt today.
 *
 * @remarks
 * Structure follows spec §3.2: orchestrator's synthesized instructions,
 * then the task file's content, then a trailing directive pointing the
 * worker at the exact staged report path. The filename is produced by
 * `formatReportFilename` so the worker writes to the same location
 * `verifyReportFile` checks. When `metadata.idempotency_check` is true the
 * `PREFLIGHT_IDEMPOTENCY_INSTRUCTION` block is prepended verbatim.
 */
export function buildWorkerPrompt(params: WorkerPromptParams): string {
  const filename = formatReportFilename(params.taskId, params.iteration);
  const reportPath = `${STAGED_DIR_REL}/${filename}`;
  const preflight = params.metadata?.idempotency_check
    ? PREFLIGHT_IDEMPOTENCY_INSTRUCTION
    : '';
  return `${preflight}${params.instructions}

## Task (${params.taskId}.md)

${params.taskContent}

---

When you are done, write a factual report to \`${reportPath}\` describing what you did and any deviations from the task spec.`;
}
