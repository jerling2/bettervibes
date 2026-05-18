import { statSync } from 'node:fs';
import { join } from 'node:path';
import { buildPaths } from './paths';
import { getManifest } from './manifest';
import { resolveBundledFile } from './bundled';

// ============================================================================
// getManifest
// ============================================================================

describe('getManifest', () => {
  const root = '/tmp/bv-manifest-fixture';
  const paths = buildPaths(root);
  const manifest = getManifest(paths);

  it('lists all seven entries in stable order', () => {
    expect(
      manifest.map((e) => ({ kind: e.kind, relPath: e.relPath }))
    ).toEqual([
      { kind: 'directory', relPath: 'tasks/new' },
      { kind: 'directory', relPath: 'tasks/stage' },
      { kind: 'directory', relPath: 'tasks/done' },
      { kind: 'directory', relPath: 'logs/worker-reports' },
      { kind: 'directory', relPath: 'scripts' },
      { kind: 'seeded-file', relPath: 'BETTER_VIBES.md' },
      { kind: 'owned-file', relPath: 'scripts/inventory.ts' },
    ]);
  });

  it('points each entry at the corresponding Paths field', () => {
    const targetsByRelPath: Record<string, string> = {};
    for (const entry of manifest) {
      targetsByRelPath[entry.relPath] = entry.target;
    }
    expect(targetsByRelPath['tasks/new']).toBe(paths.tasksNew);
    expect(targetsByRelPath['tasks/stage']).toBe(paths.tasksStage);
    expect(targetsByRelPath['tasks/done']).toBe(paths.tasksDone);
    expect(targetsByRelPath['logs/worker-reports']).toBe(paths.reports);
    expect(targetsByRelPath['scripts']).toBe(paths.scripts);
    expect(targetsByRelPath['BETTER_VIBES.md']).toBe(paths.betterVibesMd);
    expect(targetsByRelPath['scripts/inventory.ts']).toBe(paths.inventoryScript);
  });

  it('resolves every bundled source to a real file on disk', () => {
    for (const entry of manifest) {
      if (entry.kind === 'directory') continue;
      const bundled = resolveBundledFile(entry.bundledSourceName);
      expect(statSync(bundled).isFile()).toBe(true);
    }
  });

  it('places every entry under bv_orchestration/', () => {
    const prefix = join(root, 'bv_orchestration') + '/';
    for (const entry of manifest) {
      expect(entry.target.startsWith(prefix)).toBe(true);
    }
  });
});
