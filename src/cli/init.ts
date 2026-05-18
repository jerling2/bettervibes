import { copyFile, mkdir, realpath } from 'fs/promises';
import { resolveBundledFile } from '../bundled';
import { findProjectRoot } from '../projectRoot';
import { buildPaths } from '../paths';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface RunInitDeps {
  projectRootArg?: string;
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

// ============================================================================
// Init
// ============================================================================

export async function runInit(deps: RunInitDeps): Promise<number> {
  const targetArg = deps.projectRootArg ?? deps.cwd;
  let target: string;
  try {
    target = await realpath(targetArg);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      deps.stderr.write(`fatal: target directory does not exist: ${targetArg}\n`);
      return 2;
    }
    deps.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const existing = findProjectRoot(target);
  if (existing !== null) {
    deps.stderr.write(`fatal: already initialized at ${existing}\n`);
    return 2;
  }

  const paths = buildPaths(target);

  await mkdir(paths.tasksNew, { recursive: true });
  await mkdir(paths.tasksStage, { recursive: true });
  await mkdir(paths.tasksDone, { recursive: true });
  await mkdir(paths.reports, { recursive: true });
  await mkdir(paths.scripts, { recursive: true });

  await copyFile(resolveBundledFile('BETTER_VIBES_TEMPLATE.md'), paths.betterVibesMd);
  await copyFile(resolveBundledFile('inventory.ts'), paths.inventoryScript);

  deps.stdout.write(`initialized bettervibes at ${paths.bvDir}\n`);
  deps.stdout.write(`add to your .gitignore: bv_orchestration/checkpoint.sqlite\n`);
  return 0;
}
