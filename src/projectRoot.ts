import path from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ResolveOptions {
  override?: string;
  cwd?: string;
}

export const PROJECT_MARKER = 'bv_orchestration';

// ============================================================================
// Helpers
// ============================================================================

function hasMarker(dir: string): boolean {
  const candidate = path.join(dir, PROJECT_MARKER);
  if (!existsSync(candidate)) return false;
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walks up from `start` looking for a `bv_orchestration/` directory. Returns
 * the closest ancestor with the marker, or null if walk-up reaches the
 * filesystem root without finding one.
 */
export function findProjectRoot(start: string): string | null {
  let current = start;
  for (;;) {
    if (hasMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolves the BV project root by realpath-ing the input and walking up for
 * the `bv_orchestration/` marker. Throws with the agreed fatal error message
 * when no marker is found and no override is given.
 */
export function resolveProjectRoot(opts: ResolveOptions = {}): string {
  const start = opts.override ?? opts.cwd ?? process.cwd();
  const real = realpathSync(start);
  const root = findProjectRoot(real);
  if (root === null) {
    throw new Error(
      `fatal: not a bettervibes project\n` +
        `no \`bv_orchestration/\` found in ${real} or any parent directory\n` +
        `run \`bettervibes init\` to create one, or pass --project-root <path>`
    );
  }
  return root;
}
