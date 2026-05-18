import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runInventorySync } from './inventorySync';

// ============================================================================
// Test Helpers
// ============================================================================

const BUNDLED_INVENTORY = join(__dirname, '..', '..', 'docs', 'templates', 'inventory.ts');

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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bv-invsync-')));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ============================================================================
// runInventorySync
// ============================================================================

describe('runInventorySync', () => {
  it('copies the bundled inventory.ts into <project>/bv_orchestration/scripts/', async () => {
    const tmp = withTempDir();
    try {
      mkdirSync(join(tmp.dir, 'bv_orchestration'));
      const stdio = makeStdio();
      const exit = await runInventorySync({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(0);
      const dest = join(tmp.dir, 'bv_orchestration', 'scripts', 'inventory.ts');
      const written = readFileSync(dest, 'utf8');
      const bundled = readFileSync(BUNDLED_INVENTORY, 'utf8');
      expect(written).toBe(bundled);
      expect(stdio.getStdout()).toContain(`synced inventory.ts to ${dest}`);
    } finally {
      tmp.cleanup();
    }
  });

  it('creates the scripts/ directory if missing', async () => {
    const tmp = withTempDir();
    try {
      mkdirSync(join(tmp.dir, 'bv_orchestration'));
      const stdio = makeStdio();
      const exit = await runInventorySync({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(0);
      const scriptsDir = join(tmp.dir, 'bv_orchestration', 'scripts');
      expect(statSync(scriptsDir).isDirectory()).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });

  it('overwrites an existing vendored copy unconditionally', async () => {
    const tmp = withTempDir();
    try {
      const scriptsDir = join(tmp.dir, 'bv_orchestration', 'scripts');
      mkdirSync(scriptsDir, { recursive: true });
      const dest = join(scriptsDir, 'inventory.ts');
      writeFileSync(dest, '// stale local edit\n');
      const stdio = makeStdio();
      const exit = await runInventorySync({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(0);
      const written = readFileSync(dest, 'utf8');
      expect(written).not.toBe('// stale local edit\n');
      expect(written).toBe(readFileSync(BUNDLED_INVENTORY, 'utf8'));
    } finally {
      tmp.cleanup();
    }
  });

  it('honors --project-root by resolving from the override path', async () => {
    const tmp = withTempDir();
    const elsewhere = withTempDir();
    try {
      mkdirSync(join(tmp.dir, 'bv_orchestration'));
      const stdio = makeStdio();
      const exit = await runInventorySync({
        projectRootArg: tmp.dir,
        cwd: elsewhere.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(0);
      const dest = join(tmp.dir, 'bv_orchestration', 'scripts', 'inventory.ts');
      expect(statSync(dest).isFile()).toBe(true);
    } finally {
      tmp.cleanup();
      elsewhere.cleanup();
    }
  });

  it('exits 2 with a fatal error when no bv_orchestration/ is found', async () => {
    const tmp = withTempDir();
    try {
      const stdio = makeStdio();
      const exit = await runInventorySync({
        cwd: tmp.dir,
        stdout: stdio.stdout,
        stderr: stdio.stderr,
      });
      expect(exit).toBe(2);
      expect(stdio.getStderr()).toMatch(/not a bettervibes project/);
    } finally {
      tmp.cleanup();
    }
  });
});
