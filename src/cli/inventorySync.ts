import { copyFile, mkdir } from 'fs/promises';
import { resolveBundledFile } from '../bundled';
import { resolveProjectRoot } from '../projectRoot';
import { buildPaths } from '../paths';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface RunInventorySyncDeps {
  projectRootArg?: string;
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

// ============================================================================
// inventory-sync
// ============================================================================

export async function runInventorySync(
  deps: RunInventorySyncDeps
): Promise<number> {
  let root: string;
  try {
    root = resolveProjectRoot({ override: deps.projectRootArg, cwd: deps.cwd });
  } catch (err) {
    deps.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const paths = buildPaths(root);

  try {
    await mkdir(paths.scripts, { recursive: true });
    await copyFile(resolveBundledFile('inventory.ts'), paths.inventoryScript);
  } catch (err) {
    deps.stderr.write(`fatal: ${(err as Error).message}\n`);
    return 2;
  }

  deps.stdout.write(`synced inventory.ts to ${paths.inventoryScript}\n`);
  return 0;
}
