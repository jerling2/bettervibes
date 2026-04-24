import path from 'node:path';
import { readFile } from 'fs/promises';
import { assertValidTaskId } from './taskId';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Absolute path to the task source-of-truth directory.
 *
 * @remarks
 * Resolved from the consumer project's cwd — `bettervibes` is a portable CLI
 * that expects `tasks/ingest/` to live inside the project it's invoked from.
 * The directory is created on CLI boot if missing.
 */
const INGEST_DIR = path.resolve(process.cwd(), 'tasks/ingest');

/**
 * Reads the markdown for a task from the ingest directory.
 *
 * @param taskId - The task identifier. Resolved to {INGEST_DIR}/{taskId}.md.
 *   Callers pass the id from graph state; no transformation is applied.
 *
 * @remarks
 * Raises "Task not found" when the file is missing and re-throws other
 * filesystem errors verbatim. No retries — the graph is expected to fail
 * loudly on filesystem issues per spec §1.2.
 */
async function readTaskFile(taskId: string): Promise<string> {
  assertValidTaskId(taskId);
  const filePath = path.join(INGEST_DIR, `${taskId}.md`);
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Task not found: ${filePath}`);
    }
    throw err;
  }
}

export { readTaskFile };
