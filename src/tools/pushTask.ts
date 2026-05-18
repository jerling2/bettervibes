import path from 'node:path';
import { access, constants, readdir, readFile, rename, writeFile } from 'fs/promises';
import matter from 'gray-matter';
import { assertValidTaskId } from './taskId';
import type { Paths } from '../paths';

// ============================================================================
// Helpers
// ============================================================================

async function findStageTaskFile(
  stageDir: string,
  taskId: string
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(stageDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const prefix = `${taskId}-`;
  const matches = entries.filter(
    (name) => name.startsWith(prefix) && name.endsWith('.md')
  );
  if (matches.length === 0) return null;
  matches.sort();
  return matches[0];
}

async function assertTargetFree(donePath: string): Promise<void> {
  try {
    await access(donePath, constants.F_OK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  throw new Error(`push target exists: ${donePath}`);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Builds a `pushTaskSpec` bound to the resolved Paths. Moves the task spec
 * from `tasksStage/T-NN-*.md` to `tasksDone/` and flips the frontmatter
 * `status` field from `stage` to `done`.
 */
export function makePushTask(paths: Paths) {
  return async function pushTaskSpec(taskId: string): Promise<string> {
    assertValidTaskId(taskId);
    const filename = await findStageTaskFile(paths.tasksStage, taskId);
    if (filename === null) {
      throw new Error(
        `Task spec not in stage/: ${path.join(
          paths.tasksStage,
          `${taskId}-*.md`
        )}`
      );
    }
    const from = path.join(paths.tasksStage, filename);
    const to = path.join(paths.tasksDone, filename);
    await assertTargetFree(to);

    const raw = await readFile(from, 'utf8');
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    data.status = 'done';
    const updated = matter.stringify(parsed.content, data);
    await writeFile(from, updated, 'utf8');
    await rename(from, to);
    return to;
  };
}
