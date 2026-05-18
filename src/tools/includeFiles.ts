import path from 'node:path';
import { readFile } from 'fs/promises';
import type { Paths } from '../paths';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface IncludedFile {
  path: string;
  content: string;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Builds a `readIncludeFiles` bound to the resolved project root. Resolves
 * relative paths against `paths.root` (the parent of `bv_orchestration/`).
 */
export function makeIncludeFiles(paths: Paths) {
  return async function readIncludeFiles(
    inputs: string[]
  ): Promise<IncludedFile[]> {
    const out: IncludedFile[] = [];
    for (const p of inputs) {
      const absolute = path.resolve(paths.root, p);
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
  };
}
