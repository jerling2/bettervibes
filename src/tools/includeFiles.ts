import path from 'node:path';
import { readFile } from 'fs/promises';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * A single file resolved from `bettervibes run --include <paths…>`. The
 * orchestrator prompt renders these as `<file path="…">…</file>` blocks; the
 * `path` field is the absolute filesystem path so the orchestrator sees the
 * real location, not whatever shorthand the CLI caller typed.
 */
export interface IncludedFile {
  path: string;
  content: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Reads each path in argv order, resolving relative paths against the
 * consumer project's cwd (the same anchor `pushTask`/`fetchTask` use).
 *
 * @param paths - Raw paths from the CLI's `--include` token list. Order is
 *   preserved in the result so the orchestrator prompt mirrors what the user
 *   typed.
 *
 * @remarks
 * Fails loud per §1.2: ENOENT on any path becomes "Include file not found:
 * <original-path>", and other filesystem errors propagate verbatim. No
 * silent skipping — the orchestrator should never see a partial include set
 * without the user knowing.
 */
export async function readIncludeFiles(
  paths: string[]
): Promise<IncludedFile[]> {
  const out: IncludedFile[] = [];
  for (const p of paths) {
    const absolute = path.resolve(process.cwd(), p);
    let content: string;
    try {
      content = await readFile(absolute, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Include file not found: ${p}`);
      }
      throw err;
    }
    out.push({ path: absolute, content });
  }
  return out;
}
