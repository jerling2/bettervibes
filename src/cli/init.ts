import path from 'node:path';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'fs/promises';
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
// Helpers
// ============================================================================

/** Entry init ensures is present in the project `.gitignore`. The trailing
 * `*` also covers the `-shm` / `-wal` sidecar files SQLite writes. */
const GITIGNORE_ENTRY = 'bv_orchestration/checkpoint.sqlite*';

/**
 * Idempotently ensures `GITIGNORE_ENTRY` is listed in `<root>/.gitignore`,
 * creating the file if absent and appending otherwise. A no-op when the exact
 * entry is already present.
 */
async function ensureGitignoreEntry(
  root: string,
  stdout: NodeJS.WritableStream
): Promise<void> {
  const gitignorePath = path.join(root, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const present = existing
    .split('\n')
    .some((line) => line.trim() === GITIGNORE_ENTRY);
  if (present) {
    stdout.write(`.gitignore already ignores ${GITIGNORE_ENTRY}\n`);
    return;
  }

  const prefix =
    existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
  await writeFile(gitignorePath, `${prefix}${GITIGNORE_ENTRY}\n`, 'utf8');
  stdout.write(`added ${GITIGNORE_ENTRY} to .gitignore\n`);
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
  await ensureGitignoreEntry(target, deps.stdout);
  return 0;
}
