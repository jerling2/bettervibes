import path from 'node:path';
import { access, constants, readdir, rename } from 'fs/promises';
import { assertValidTaskId } from './taskId';

// ============================================================================
// Helpers
// ============================================================================

const REPORT_FILENAME_PATTERN = /^(.+?)-(\d+)\.md$/;

/**
 * Absolute paths to the staged and done directories.
 *
 * @remarks
 * Resolved from the consumer project's cwd — `bettervibes` is a portable CLI
 * that expects `tasks/{staged,done}/` to live inside the project it's invoked
 * from. Directories are created on CLI boot if missing.
 */
const STAGED_DIR = path.resolve(process.cwd(), 'tasks/staged');
const DONE_DIR = path.resolve(process.cwd(), 'tasks/done');

/**
 * Returns the iteration number if `name` is a report for `taskId`.
 *
 * @param taskId - The canonical task identifier. Caller has validated it.
 * @param name - The candidate filename (basename, not a full path).
 *
 * @remarks
 * A report matches iff stripping the trailing `-\d+` and `.md` suffix yields
 * exactly `taskId`. This excludes prefix collisions like `task-extended-01.md`
 * when `taskId` is `task`, per the rule in spec §5.2.
 */
function matchReportFile(
  taskId: string,
  name: string
): { iteration: number } | null {
  const match = REPORT_FILENAME_PATTERN.exec(name);
  if (!match) return null;
  const [, base, iterationStr] = match;
  if (base !== taskId) return null;
  return { iteration: Number(iterationStr) };
}

/**
 * Returns every staged report belonging to the task, sorted ascending by
 * iteration.
 *
 * @param taskId - The canonical task identifier. Assumed validated.
 *
 * @remarks
 * Returns an empty array when nothing matches — the caller decides whether
 * that is fatal. Filename filtering excludes nearly all non-report entries;
 * a directory named with the exact report pattern would rename anyway,
 * which is acceptable for v1.
 */
async function collectStagedReports(
  taskId: string
): Promise<{ name: string; iteration: number }[]> {
  const entries = await readdir(STAGED_DIR);
  const matches: { name: string; iteration: number }[] = [];
  for (const name of entries) {
    const match = matchReportFile(taskId, name);
    if (match) matches.push({ name, iteration: match.iteration });
  }
  matches.sort((a, b) => a.iteration - b.iteration);
  return matches;
}

/**
 * Throws "push target exists" if `donePath` already has a file.
 *
 * @param donePath - Destination path under tasks/done/. A pre-existing target
 *   means a prior greenlight closed the same task-iteration already, which is
 *   a state bug rather than a retry scenario.
 *
 * @remarks
 * Required because `fs.rename` on POSIX silently overwrites a regular-file
 * target. Uses `fs.access` with `F_OK` — resolves iff the file exists.
 */
async function assertTargetFree(donePath: string): Promise<void> {
  try {
    await access(donePath, constants.F_OK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  throw new Error(`push target exists: ${donePath}`);
}

/**
 * Moves every staged iteration of the given task into tasks/done/.
 *
 * @param taskId - The task identifier. All files whose stripped basename
 *   equals this value are moved.
 *
 * @remarks
 * Fails loud on: invalid task_id, zero matches, target-exists, or any
 * filesystem error. On partial failure, already-moved files stay in done/;
 * no rollback is attempted — the human diagnoses and repairs per §1.2.
 * Returns the new done/ paths in ascending iteration order.
 */
async function pushReports(taskId: string): Promise<string[]> {
  assertValidTaskId(taskId);
  const reports = await collectStagedReports(taskId);
  if (reports.length === 0) {
    throw new Error(`no staged reports found for task: ${taskId}`);
  }
  const moved: string[] = [];
  for (const report of reports) {
    const from = path.join(STAGED_DIR, report.name);
    const to = path.join(DONE_DIR, report.name);
    await assertTargetFree(to);
    await rename(from, to);
    moved.push(to);
  }
  return moved;
}

export { pushReports };
