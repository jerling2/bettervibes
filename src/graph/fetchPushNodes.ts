import { readTaskFile } from '../tools/fetchTask';
import { pushReports } from '../tools/pushTask';
import type { GraphStateType } from './state';

// ============================================================================
// Nodes
// ============================================================================

/**
 * Loads the task markdown from `tasks/ingest/` into graph state.
 *
 * @param state - Graph state. `task_id` must be set by the caller (the CLI
 *   seeds it at graph invocation).
 *
 * @remarks
 * Deterministic side-effect node. The orchestrator has no fetch tool in v1;
 * the graph loads the task up-front so every orchestrator turn sees a
 * populated `task_content` in its prompt. ENOENT / invalid-task-id errors
 * propagate per the fail-loud policy (§1.2).
 */
export async function fetchTaskNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  if (state.task_id === null) {
    throw new Error('fetchTaskNode: state.task_id is null');
  }
  const { body, metadata } = await readTaskFile(state.task_id);
  return { task_content: body, task_metadata: metadata };
}

/**
 * Promotes all staged iterations of the current task from `tasks/staged/` to
 * `tasks/done/`.
 *
 * @param state - Graph state. `task_id` must be set.
 *
 * @remarks
 * Runs on the greenlight branch after `HUMAN_INT`. Returns an empty state
 * update — the done/ paths are not persisted in state (the report_path field
 * holds the last staged path, which is still a valid historical reference).
 * Errors propagate per §1.2; no rollback on partial failure.
 */
export async function pushTaskNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  if (state.task_id === null) {
    throw new Error('pushTaskNode: state.task_id is null');
  }
  await pushReports(state.task_id);
  return {};
}
