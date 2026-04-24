// ============================================================================
// Helpers
// ============================================================================

/**
 * Throws if the given task_id would escape its task directory or is blank.
 *
 * @param taskId - The raw task_id from the caller. Validated before use so
 *   path-traversal inputs cannot reach the filesystem.
 *
 * @remarks
 * Rejects empty/whitespace input, any path separator, and parent-directory
 * tokens. Raises a plain Error per the fail-loud policy. Shared by fetchTask,
 * commitTask, and pushTask.
 */
export function assertValidTaskId(taskId: string): void {
  if (!taskId || !taskId.trim()) {
    throw new Error('invalid task_id: empty or whitespace');
  }
  if (taskId.includes('/') || taskId.includes('\\') || taskId.includes('..')) {
    throw new Error(`invalid task_id: ${taskId}`);
  }
}
