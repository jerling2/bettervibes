import { formatReportFilename } from '../tools/commitTask';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WorkerPromptParams {
  instructions: string;
  taskContent: string;
  taskId: string;
  iteration: number;
}

// ============================================================================
// Helpers
// ============================================================================

const STAGED_DIR_REL = 'tasks/staged';

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Builds the single user message the worker sends to the Claude Agent SDK.
 *
 * @param params - Orchestrator-supplied instructions, the raw task content,
 *   the task_id, and the current iteration. The task_id and iteration drive
 *   the report path, which must match what `commitTask` validates against.
 *
 * @remarks
 * Structure follows spec §3.2: orchestrator's synthesized instructions,
 * then the task file's content, then a trailing directive pointing the
 * worker at the exact staged report path. The filename is produced by
 * `formatReportFilename` so the worker writes to the same location
 * `verifyReportFile` checks.
 */
export function buildWorkerPrompt(params: WorkerPromptParams): string {
  const filename = formatReportFilename(params.taskId, params.iteration);
  const reportPath = `${STAGED_DIR_REL}/${filename}`;
  return `${params.instructions}

## Task (${params.taskId}.md)

${params.taskContent}

---

When you are done, write a factual report to \`${reportPath}\` describing what you did and any deviations from the task spec.`;
}
