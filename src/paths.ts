import path from 'node:path';
import { PROJECT_MARKER } from './projectRoot';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Paths {
  root: string;
  bvDir: string;
  bvVersion: string;
  tasksNew: string;
  tasksStage: string;
  tasksDone: string;
  reports: string;
  checkpoint: string;
  betterVibesMd: string;
  scripts: string;
  inventoryScript: string;
  inventoryCsv: string;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Builds the absolute Paths object rooted at the resolved project root.
 */
export function buildPaths(root: string): Paths {
  const bvDir = path.join(root, PROJECT_MARKER);
  return {
    root,
    bvDir,
    bvVersion: path.join(bvDir, '.bvversion'),
    tasksNew: path.join(bvDir, 'tasks', 'new'),
    tasksStage: path.join(bvDir, 'tasks', 'stage'),
    tasksDone: path.join(bvDir, 'tasks', 'done'),
    reports: path.join(bvDir, 'logs', 'worker-reports'),
    checkpoint: path.join(bvDir, 'checkpoint.sqlite'),
    betterVibesMd: path.join(bvDir, 'BETTER_VIBES.md'),
    scripts: path.join(bvDir, 'scripts'),
    inventoryScript: path.join(bvDir, 'scripts', 'inventory.ts'),
    inventoryCsv: path.join(bvDir, 'inventory.csv'),
  };
}
