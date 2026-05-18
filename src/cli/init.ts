import { copyFile, mkdir, realpath, writeFile } from 'fs/promises';
import { resolveBundledFile } from '../bundled';
import { findProjectRoot } from '../projectRoot';
import { buildPaths } from '../paths';
import { getManifest } from '../manifest';
import { getBvVersion } from '../version';

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

  for (const entry of getManifest(paths)) {
    if (entry.kind === 'directory') {
      await mkdir(entry.target, { recursive: true });
    } else {
      await copyFile(resolveBundledFile(entry.bundledSourceName), entry.target);
    }
  }

  await writeFile(paths.bvVersion, `${getBvVersion()}\n`, 'utf8');

  deps.stdout.write(`initialized bettervibes at ${paths.bvDir}\n`);
  deps.stdout.write(`add to your .gitignore: bv_orchestration/checkpoint.sqlite\n`);
  return 0;
}
