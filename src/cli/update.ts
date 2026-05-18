import {
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'fs/promises';
import { resolveBundledFile } from '../bundled';
import { resolveProjectRoot } from '../projectRoot';
import { buildPaths } from '../paths';
import { getManifest, type ManifestEntry } from '../manifest';
import { getBvVersion } from '../version';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface RunUpdateDeps {
  projectRootArg?: string;
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  dryRun: boolean;
}

type EntryAction = 'created' | 'restored' | 'updated' | 'unchanged';

// ============================================================================
// update
// ============================================================================

export async function runUpdate(deps: RunUpdateDeps): Promise<number> {
  let root: string;
  try {
    root = resolveProjectRoot({ override: deps.projectRootArg, cwd: deps.cwd });
  } catch (err) {
    deps.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const paths = buildPaths(root);
  const manifest = getManifest(paths);
  const currentVersion = getBvVersion();
  const existingVersion = await readExistingVersion(paths.bvVersion);

  try {
    for (const entry of manifest) {
      const action = await applyEntry(entry, deps.dryRun);
      deps.stdout.write(`${formatLine(action, entry.relPath, deps.dryRun)}\n`);
    }

    deps.stdout.write(
      `${formatVersionLine(existingVersion, currentVersion, deps.dryRun)}\n`
    );

    if (!deps.dryRun) {
      await writeFile(paths.bvVersion, `${currentVersion}\n`, 'utf8');
    }
  } catch (err) {
    deps.stderr.write(`fatal: ${(err as Error).message}\n`);
    return 2;
  }

  return 0;
}

// ============================================================================
// Helpers
// ============================================================================

async function applyEntry(
  entry: ManifestEntry,
  dryRun: boolean
): Promise<EntryAction> {
  if (entry.kind === 'directory') {
    if (await pathExists(entry.target)) {
      return 'unchanged';
    }
    if (!dryRun) {
      await mkdir(entry.target, { recursive: true });
    }
    return 'created';
  }

  if (entry.kind === 'seeded-file') {
    if (await pathExists(entry.target)) {
      return 'unchanged';
    }
    if (!dryRun) {
      await copyFile(resolveBundledFile(entry.bundledSourceName), entry.target);
    }
    return 'restored';
  }

  // owned-file
  const bundledPath = resolveBundledFile(entry.bundledSourceName);
  if (await filesEqual(bundledPath, entry.target)) {
    return 'unchanged';
  }
  if (!dryRun) {
    await copyFile(bundledPath, entry.target);
  }
  return 'updated';
}

const DRY_RUN_VERB: Record<EntryAction, string> = {
  created: 'would create',
  restored: 'would restore',
  updated: 'would update',
  unchanged: 'unchanged',
};

function formatLine(
  action: EntryAction,
  relPath: string,
  dryRun: boolean
): string {
  if (!dryRun) {
    return `${action}: ${relPath}`;
  }
  return `${DRY_RUN_VERB[action]}: ${relPath}`;
}

function formatVersionLine(
  existing: string,
  current: string,
  dryRun: boolean
): string {
  const body =
    existing === current
      ? `version: ${current}`
      : `version: ${existing} -> ${current}`;
  return dryRun ? `would write ${body}` : body;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function filesEqual(a: string, b: string): Promise<boolean> {
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = await readFile(a);
  } catch {
    return false;
  }
  try {
    bufB = await readFile(b);
  } catch {
    return false;
  }
  return bufA.equals(bufB);
}

async function readExistingVersion(versionPath: string): Promise<string> {
  try {
    const raw = await readFile(versionPath, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length === 0 ? '(none)' : trimmed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '(none)';
    }
    throw err;
  }
}
