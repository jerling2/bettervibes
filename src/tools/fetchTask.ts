import path from 'node:path';
import { readFile } from 'fs/promises';
import matter from 'gray-matter';
import { z } from 'zod';
import { assertValidTaskId } from './taskId';

// ============================================================================
// Schemas
// ============================================================================

/**
 * Recognized fields in a task ingest file's YAML frontmatter.
 *
 * @remarks
 * Unknown keys are preserved (`passthrough`) so users can stash forward-
 * compatible metadata or upstream tooling fields like `task_id` without the
 * orchestrator rejecting them. Validation only enforces the *types* of the
 * keys the orchestrator acts on.
 *
 * `idempotency_check` opts a task into a pre-flight idempotency probe in the
 * worker's prompt. See `PREFLIGHT_IDEMPOTENCY_INSTRUCTION` in
 * `src/prompts/worker.ts`.
 */
export const TaskMetadataSchema = z
  .object({
    idempotency_check: z.boolean().optional(),
  })
  .passthrough();

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

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

export interface TaskFile {
  body: string;
  metadata: TaskMetadata;
}

/**
 * Reads and parses a task ingest file.
 *
 * @param taskId - The task identifier. Resolved to {INGEST_DIR}/{taskId}.md.
 *   Callers pass the id from graph state; no transformation is applied.
 *
 * @returns The markdown body (frontmatter stripped) and the parsed metadata.
 *   Files without frontmatter return `metadata = {}`.
 *
 * @remarks
 * Raises "Task not found" when the file is missing and re-throws other
 * filesystem errors verbatim. Frontmatter that fails YAML parsing or zod
 * validation throws per the fail-loud policy (§1.2). Unknown keys in
 * frontmatter pass through validation; only typed keys (e.g. boolean
 * `idempotency_check`) are enforced.
 */
async function readTaskFile(taskId: string): Promise<TaskFile> {
  assertValidTaskId(taskId);
  const filePath = path.join(INGEST_DIR, `${taskId}.md`);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Task not found: ${filePath}`);
    }
    throw err;
  }
  const parsed = matter(raw);
  const metadata = TaskMetadataSchema.parse(parsed.data);
  return { body: parsed.content, metadata };
}

export { readTaskFile };
