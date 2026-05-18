import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runInit } from './init';
import { runUpdate } from './update';
import { getBvVersion } from '../version';

// ============================================================================
// Test Helpers
// ============================================================================

const BUNDLED_INVENTORY = join(__dirname, '..', '..', 'docs', 'templates', 'inventory.ts');
const BUNDLED_BV_MD = join(__dirname, '..', '..', 'docs', 'templates', 'BETTER_VIBES_TEMPLATE.md');

function makeStdio() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  stdout.on('data', (c: Buffer) => stdoutChunks.push(c.toString('utf8')));
  stderr.on('data', (c: Buffer) => stderrChunks.push(c.toString('utf8')));
  return {
    stdout,
    stderr,
    getStdout: () => stdoutChunks.join(''),
    getStderr: () => stderrChunks.join(''),
  };
}

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bv-update-')));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function initFresh(root: string): Promise<void> {
  const stdio = makeStdio();
  const exit = await runInit({
    cwd: root,
    stdout: stdio.stdout,
    stderr: stdio.stderr,
  });
  if (exit !== 0) {
    throw new Error(`init failed: ${stdio.getStderr()}`);
  }
}

// ============================================================================
// runUpdate
// ============================================================================

describe('runUpdate', () => {
  it('returns 0 and prints all unchanged: lines on a freshly init\'d project', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);

      const out = stdio.getStdout();
      expect(out).toContain('unchanged: tasks/new\n');
      expect(out).toContain('unchanged: tasks/stage\n');
      expect(out).toContain('unchanged: tasks/done\n');
      expect(out).toContain('unchanged: logs/worker-reports\n');
      expect(out).toContain('unchanged: scripts\n');
      expect(out).toContain('unchanged: BETTER_VIBES.md\n');
      expect(out).toContain('unchanged: scripts/inventory.ts\n');
      expect(out).toContain(`version: ${getBvVersion()}\n`);
    } finally {
      tmp.cleanup();
    }
  });

  it('restores a missing seeded file and recreates a missing bucket', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      const bvDir = join(tmp.dir, 'bv_orchestration');
      rmSync(join(bvDir, 'BETTER_VIBES.md'));
      rmSync(join(bvDir, 'tasks', 'stage'), { recursive: true, force: true });

      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);

      const out = stdio.getStdout();
      expect(out).toContain('created: tasks/stage\n');
      expect(out).toContain('restored: BETTER_VIBES.md\n');

      expect(statSync(join(bvDir, 'tasks', 'stage')).isDirectory()).toBe(true);
      expect(readFileSync(join(bvDir, 'BETTER_VIBES.md'), 'utf8')).toBe(
        readFileSync(BUNDLED_BV_MD, 'utf8')
      );
    } finally {
      tmp.cleanup();
    }
  });

  it('overwrites a drifted owned file with the bundled source', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      const target = join(tmp.dir, 'bv_orchestration', 'scripts', 'inventory.ts');
      writeFileSync(target, '// drift\n', 'utf8');

      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);
      expect(stdio.getStdout()).toContain('updated: scripts/inventory.ts\n');
      expect(readFileSync(target, 'utf8')).toBe(
        readFileSync(BUNDLED_INVENTORY, 'utf8')
      );
    } finally {
      tmp.cleanup();
    }
  });

  it('never overwrites an existing (customized) seeded file', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      const target = join(tmp.dir, 'bv_orchestration', 'BETTER_VIBES.md');
      const custom = '# my customizations\n';
      writeFileSync(target, custom, 'utf8');

      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);
      expect(stdio.getStdout()).toContain('unchanged: BETTER_VIBES.md\n');
      expect(readFileSync(target, 'utf8')).toBe(custom);
    } finally {
      tmp.cleanup();
    }
  });

  it('leaves consumer data under tasks/ and logs/ untouched', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      const bvDir = join(tmp.dir, 'bv_orchestration');
      const taskSpec = join(bvDir, 'tasks', 'new', 'T-99-fake.md');
      const report = join(bvDir, 'logs', 'worker-reports', 'fake-report.md');
      const csv = join(bvDir, 'inventory.csv');
      writeFileSync(taskSpec, 'task body\n', 'utf8');
      writeFileSync(report, 'report body\n', 'utf8');
      writeFileSync(csv, 'csv body\n', 'utf8');

      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);

      expect(readFileSync(taskSpec, 'utf8')).toBe('task body\n');
      expect(readFileSync(report, 'utf8')).toBe('report body\n');
      expect(readFileSync(csv, 'utf8')).toBe('csv body\n');
    } finally {
      tmp.cleanup();
    }
  });

  it('--dry-run prints would-prefixed verbs and performs no writes', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      const bvDir = join(tmp.dir, 'bv_orchestration');
      const seededTarget = join(bvDir, 'BETTER_VIBES.md');
      const bucket = join(bvDir, 'tasks', 'stage');
      const ownedTarget = join(bvDir, 'scripts', 'inventory.ts');
      rmSync(seededTarget);
      rmSync(bucket, { recursive: true, force: true });
      writeFileSync(ownedTarget, '// drift\n', 'utf8');
      // Pre-write .bvversion mismatch to verify the dry-run version line shape.
      writeFileSync(join(bvDir, '.bvversion'), '0.9.0\n', 'utf8');

      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: true,
      });
      expect(exit).toBe(0);

      const out = stdio.getStdout();
      expect(out).toContain('would create: tasks/stage\n');
      expect(out).toContain('would restore: BETTER_VIBES.md\n');
      expect(out).toContain('would update: scripts/inventory.ts\n');
      expect(out).toContain(
        `would write version: 0.9.0 -> ${getBvVersion()}\n`
      );

      expect(existsSync(seededTarget)).toBe(false);
      expect(existsSync(bucket)).toBe(false);
      expect(readFileSync(ownedTarget, 'utf8')).toBe('// drift\n');
      // .bvversion should not have been rewritten by a dry-run.
      expect(readFileSync(join(bvDir, '.bvversion'), 'utf8')).toBe('0.9.0\n');
    } finally {
      tmp.cleanup();
    }
  });

  it('writes .bvversion containing the current package version on a real run', async () => {
    const tmp = withTempDir();
    try {
      await initFresh(tmp.dir);
      // Stomp .bvversion so we can confirm update rewrites it.
      const versionPath = join(tmp.dir, 'bv_orchestration', '.bvversion');
      writeFileSync(versionPath, '0.9.0\n', 'utf8');

      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);
      expect(stdio.getStdout()).toContain(
        `version: 0.9.0 -> ${getBvVersion()}\n`
      );
      expect(readFileSync(versionPath, 'utf8').trim()).toBe(getBvVersion());
    } finally {
      tmp.cleanup();
    }
  });

  it('exits 2 when no bv_orchestration/ marker is found', async () => {
    const tmp = withTempDir();
    try {
      const stdio = makeStdio();
      const exit = await runUpdate({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(2);
      expect(stdio.getStderr()).toMatch(/not a bettervibes project/);
    } finally {
      tmp.cleanup();
    }
  });

  it('honors --project-root via projectRootArg', async () => {
    const tmp = withTempDir();
    const elsewhere = withTempDir();
    try {
      await initFresh(tmp.dir);
      const stdio = makeStdio();
      const exit = await runUpdate({
        projectRootArg: tmp.dir,
        cwd: elsewhere.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
        dryRun: false,
      });
      expect(exit).toBe(0);
      expect(stdio.getStdout()).toContain('unchanged: scripts/inventory.ts\n');
    } finally {
      tmp.cleanup();
      elsewhere.cleanup();
    }
  });
});
