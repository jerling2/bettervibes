import path from 'node:path';
import { access, constants, readdir, readFile, writeFile } from 'fs/promises';
import matter from 'gray-matter';
import { assertValidTaskId } from './taskId';
import type { Paths } from '../paths';

// ============================================================================
// Helpers
// ============================================================================

function assertValidIteration(iteration: number): void {
  if (!Number.isInteger(iteration) || iteration <= 0) {
    throw new Error(`invalid iteration: ${iteration}`);
  }
}

export function formatWrId(iteration: number): string {
  return `WR-${iteration.toString().padStart(2, '0')}`;
}

const WR_FILENAME_RE = /^WR-(\d+)-.*\.md$/;

/**
 * Scans the worker-reports directory and returns the next WR-NN integer:
 * `max(WR-NN found on disk) + 1`, or `1` when the directory is empty or
 * missing. WR-NN is project-global, derived from the directory contents
 * rather than from in-memory state.
 */
export async function nextWrIteration(reportsDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(reportsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 1;
    throw err;
  }
  let max = 0;
  for (const name of entries) {
    const match = WR_FILENAME_RE.exec(name);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Local-timezone `YYYY-MM-DD`. Uses the Date's local calendar components (not
 * UTC) so report filenames and `date:` fields track the operator's workday;
 * `toISOString()` would roll a day early for operators west of UTC.
 */
export function todayYmd(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TASK_HEADING_RE = /^#\s+Task:\s*(.+?)\s*$/m;
const SLUG_FALLBACK = 'task';

export function deriveSlug(taskBody: string | null): string {
  if (!taskBody) return SLUG_FALLBACK;
  const match = TASK_HEADING_RE.exec(taskBody);
  if (!match) return SLUG_FALLBACK;
  const raw = match[1]
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw.length > 0 ? raw : SLUG_FALLBACK;
}

export function formatReportFilename(
  iteration: number,
  slug: string,
  date: string = todayYmd()
): string {
  return `${formatWrId(iteration)}-${slug}-${date}.md`;
}

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

// ============================================================================
// Factory
// ============================================================================

export interface CommitTaskInput {
  taskId: string;
  iteration: number;
  slug: string;
  date?: string;
}

export interface CommitTaskResult {
  reportPath: string;
  wrId: string;
}

/**
 * Builds a `commitTask` bound to the resolved Paths. Verifies the worker
 * report exists at the expected path under `logs/worker-reports/` and updates
 * the source task spec's `worker-reports` frontmatter array with the new
 * WR-NN reference.
 */
export function makeCommitTask(paths: Paths) {
  return async function commitTask(
    input: CommitTaskInput
  ): Promise<CommitTaskResult> {
    assertValidTaskId(input.taskId);
    assertValidIteration(input.iteration);
    const filename = formatReportFilename(
      input.iteration,
      input.slug,
      input.date
    );
    const reportPath = path.join(paths.reports, filename);

    try {
      await access(reportPath, constants.R_OK);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Report not found: ${reportPath}`);
      }
      throw err;
    }

    const wrId = formatWrId(input.iteration);

    const taskFilename = await findStageTaskFile(paths.tasksStage, input.taskId);
    if (taskFilename === null) {
      throw new Error(
        `Task spec not in stage/: ${path.join(
          paths.tasksStage,
          `${input.taskId}-*.md`
        )}`
      );
    }
    const taskPath = path.join(paths.tasksStage, taskFilename);
    const raw = await readFile(taskPath, 'utf8');
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const existing = data['worker-reports'];
    const arr = Array.isArray(existing) ? [...existing] : [];
    arr.push(wrId);
    data['worker-reports'] = arr;
    const updated = matter.stringify(parsed.content, data);
    await writeFile(taskPath, updated, 'utf8');

    return { reportPath, wrId };
  };
}
