import path from 'node:path';
import { access, constants } from 'fs/promises';
import { assertValidTaskId } from './taskId';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Absolute path to the staged-reports directory.
 *
 * @remarks
 * Resolved from the consumer project's cwd — `bettervibes` is a portable CLI
 * that expects `tasks/staged/` to live inside the project it's invoked from.
 * The directory is created on CLI boot if missing.
 */
const STAGED_DIR = path.resolve(process.cwd(), 'tasks/staged');

/**
 * Throws if the iteration number is not a positive integer.
 *
 * @param iteration - The iteration counter from graph state. Passed through
 *   without coercion so non-finite inputs surface as errors rather than being
 *   silently formatted into a filename.
 *
 * @remarks
 * The zod schema enforces the same rule at the tool boundary; this guard
 * exists so direct callers of `verifyReportFile` (e.g. tests, or future
 * internal callers) get the same protection.
 */
function assertValidIteration(iteration: number): void {
  if (!Number.isInteger(iteration) || iteration <= 0) {
    throw new Error(`invalid iteration: ${iteration}`);
  }
}

/**
 * Returns the expected report filename for a given task and iteration.
 *
 * @param taskId - Assumed valid. Caller must call `assertValidTaskId` first.
 * @param iteration - Assumed positive integer. Caller must call
 *   `assertValidIteration` first.
 *
 * @remarks
 * Iteration is zero-padded to two digits per the `-01`, `-02` convention
 * in spec §1.2.
 */
function formatReportFilename(taskId: string, iteration: number): string {
  const padded = iteration.toString().padStart(2, '0');
  return `${taskId}-${padded}.md`;
}

/**
 * Confirms that the worker wrote a report for the given task and iteration.
 *
 * @param taskId - The task identifier. Combined with iteration to derive
 *   the expected filename under tasks/staged/.
 * @param iteration - The current iteration counter. 1-indexed per spec §4.3.
 *
 * @remarks
 * Uses fs.access with R_OK — validates existence and readability in one call.
 * Raises "Report not found" on ENOENT and re-throws other filesystem errors
 * verbatim. The return value is the absolute path; consuming nodes write it
 * into state.report_path.
 */
async function verifyReportFile(
  taskId: string,
  iteration: number
): Promise<string> {
  assertValidTaskId(taskId);
  assertValidIteration(iteration);
  const filePath = path.join(STAGED_DIR, formatReportFilename(taskId, iteration));
  try {
    await access(filePath, constants.R_OK);
    return filePath;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Report not found: ${filePath}`);
    }
    throw err;
  }
}

export { formatReportFilename, verifyReportFile };
