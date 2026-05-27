import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runInit } from './init';
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bv-init-')));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ============================================================================
// runInit
// ============================================================================

describe('runInit', () => {
  it('creates the full bv_orchestration tree and vendors both templates', async () => {
    const tmp = withTempDir();
    try {
      const stdio = makeStdio();
      const exit = await runInit({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(0);

      const bvDir = join(tmp.dir, 'bv_orchestration');
      expect(statSync(join(bvDir, 'tasks', 'new')).isDirectory()).toBe(true);
      expect(statSync(join(bvDir, 'tasks', 'stage')).isDirectory()).toBe(true);
      expect(statSync(join(bvDir, 'tasks', 'done')).isDirectory()).toBe(true);
      expect(statSync(join(bvDir, 'logs', 'worker-reports')).isDirectory()).toBe(true);
      expect(statSync(join(bvDir, 'scripts')).isDirectory()).toBe(true);

      const bvMd = readFileSync(join(bvDir, 'BETTER_VIBES.md'), 'utf8');
      expect(bvMd).toBe(readFileSync(BUNDLED_BV_MD, 'utf8'));

      const inventory = readFileSync(join(bvDir, 'scripts', 'inventory.ts'), 'utf8');
      expect(inventory).toBe(readFileSync(BUNDLED_INVENTORY, 'utf8'));

      const bvVersion = readFileSync(join(bvDir, '.bvversion'), 'utf8');
      expect(bvVersion.trim()).toBe(getBvVersion());

      expect(stdio.getStdout()).toContain(`initialized bettervibes at ${bvDir}`);
    } finally {
      tmp.cleanup();
    }
  });

  it('refuses to initialize when bv_orchestration/ already exists', async () => {
    const tmp = withTempDir();
    try {
      mkdirSync(join(tmp.dir, 'bv_orchestration'));
      const stdio = makeStdio();
      const exit = await runInit({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(2);
      expect(stdio.getStderr()).toMatch(/already initialized/);
    } finally {
      tmp.cleanup();
    }
  });

  it('honors --project-root', async () => {
    const tmp = withTempDir();
    const elsewhere = withTempDir();
    try {
      const stdio = makeStdio();
      const exit = await runInit({
        projectRootArg: tmp.dir,
        cwd: elsewhere.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(0);
      expect(statSync(join(tmp.dir, 'bv_orchestration', 'scripts', 'inventory.ts')).isFile()).toBe(true);
    } finally {
      tmp.cleanup();
      elsewhere.cleanup();
    }
  });
});

// ============================================================================
// runInit .gitignore handling (#7)
// ============================================================================

describe('runInit .gitignore handling', () => {
  const ENTRY = 'bv_orchestration/checkpoint.sqlite*';

  async function init(dir: string) {
    const stdio = makeStdio();
    const exit = await runInit({
      projectRootArg: dir,
      cwd: dir,
      stdout: stdio.stdout,
      stderr: stdio.stderr,
    });
    return { exit, stdout: stdio.getStdout() };
  }

  it('creates .gitignore with the entry when none exists', async () => {
    const tmp = withTempDir();
    try {
      const { exit } = await init(tmp.dir);
      expect(exit).toBe(0);
      expect(readFileSync(join(tmp.dir, '.gitignore'), 'utf8')).toContain(ENTRY);
    } finally {
      tmp.cleanup();
    }
  });

  it('appends to an existing .gitignore that lacks the entry', async () => {
    const tmp = withTempDir();
    try {
      writeFileSync(join(tmp.dir, '.gitignore'), 'node_modules\n');
      const { exit } = await init(tmp.dir);
      expect(exit).toBe(0);
      expect(readFileSync(join(tmp.dir, '.gitignore'), 'utf8')).toBe(
        `node_modules\n${ENTRY}\n`
      );
    } finally {
      tmp.cleanup();
    }
  });

  it('is a no-op when the entry is already present', async () => {
    const tmp = withTempDir();
    try {
      writeFileSync(join(tmp.dir, '.gitignore'), `foo\n${ENTRY}\n`);
      const { exit, stdout } = await init(tmp.dir);
      expect(exit).toBe(0);
      expect(readFileSync(join(tmp.dir, '.gitignore'), 'utf8')).toBe(
        `foo\n${ENTRY}\n`
      );
      expect(stdout).toContain('already ignores');
    } finally {
      tmp.cleanup();
    }
  });
});
