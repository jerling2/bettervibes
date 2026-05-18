import path from 'node:path';
import type { Paths } from './paths';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type ManifestEntry =
  | { kind: 'directory'; relPath: string; target: string }
  | {
      kind: 'seeded-file';
      relPath: string;
      target: string;
      bundledSourceName: string;
    }
  | {
      kind: 'owned-file';
      relPath: string;
      target: string;
      bundledSourceName: string;
    };

// ============================================================================
// Manifest
// ============================================================================

/**
 * Single source of truth for every path BV ships into a consumer project.
 * Both `bettervibes init` and `bettervibes update` iterate this list.
 *
 * Order is stable and load-bearing: `update` prints status lines in this
 * exact order (FR-7).
 */
export function getManifest(paths: Paths): ManifestEntry[] {
  return [
    {
      kind: 'directory',
      relPath: 'tasks/new',
      target: paths.tasksNew,
    },
    {
      kind: 'directory',
      relPath: 'tasks/stage',
      target: paths.tasksStage,
    },
    {
      kind: 'directory',
      relPath: 'tasks/done',
      target: paths.tasksDone,
    },
    {
      kind: 'directory',
      relPath: path.posix.join('logs', 'worker-reports'),
      target: paths.reports,
    },
    {
      kind: 'directory',
      relPath: 'scripts',
      target: paths.scripts,
    },
    {
      kind: 'seeded-file',
      relPath: 'BETTER_VIBES.md',
      target: paths.betterVibesMd,
      bundledSourceName: 'BETTER_VIBES_TEMPLATE.md',
    },
    {
      kind: 'owned-file',
      relPath: path.posix.join('scripts', 'inventory.ts'),
      target: paths.inventoryScript,
      bundledSourceName: 'inventory.ts',
    },
  ];
}
