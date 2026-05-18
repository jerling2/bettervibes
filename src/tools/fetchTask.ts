import path from 'node:path';
import { readdir, readFile } from 'fs/promises';
import matter from 'gray-matter';
import { z } from 'zod';
import { assertValidTaskId } from './taskId';
import type { Paths } from '../paths';

// ============================================================================
// Schemas
// ============================================================================

export const TaskMetadataSchema = z
  .object({
    idempotency_check: z.boolean().optional(),
  })
  .passthrough();

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface TaskFile {
  body: string;
  metadata: TaskMetadata;
  filename: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function findTaskFile(
  dir: string,
  taskId: string
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const prefix = `${taskId}-`;
  const matches = entries.filter(
    (name) => name.startsWith(prefix) && name.endsWith('.md')
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    matches.sort();
  }
  return matches[0];
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Builds a `readTaskFile` bound to the resolved Paths. Reads the task spec
 * from `tasksNew/T-NN-*.md` (matched by the `T-NN-` prefix).
 */
export function makeFetchTask(paths: Paths) {
  return async function readTaskFile(taskId: string): Promise<TaskFile> {
    assertValidTaskId(taskId);
    const filename = await findTaskFile(paths.tasksNew, taskId);
    if (filename === null) {
      throw new Error(
        `Task not found: ${path.join(paths.tasksNew, `${taskId}-*.md`)}`
      );
    }
    const filePath = path.join(paths.tasksNew, filename);
    const raw = await readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const metadata = TaskMetadataSchema.parse(parsed.data);
    return { body: parsed.content, metadata, filename };
  };
}
