import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ============================================================================
// Test Helpers
// ============================================================================

const REPO_ROOT = resolve(__dirname, '..');
const INVENTORY_SCRIPT = join(REPO_ROOT, 'docs', 'templates', 'inventory.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
  csv: string;
}

function withTempProject(): { dir: string; bvDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'bv-inventory-'));
  const bvDir = join(dir, 'bv_orchestration');
  mkdirSync(join(bvDir, 'tasks', 'new'), { recursive: true });
  mkdirSync(join(bvDir, 'tasks', 'stage'), { recursive: true });
  mkdirSync(join(bvDir, 'tasks', 'done'), { recursive: true });
  mkdirSync(join(bvDir, 'logs', 'worker-reports'), { recursive: true });
  return {
    dir,
    bvDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function runInventory(cwd: string): RunResult {
  const result = spawnSync(TSX_BIN, [INVENTORY_SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  let csv = '';
  try {
    csv = readFileSync(join(cwd, 'bv_orchestration', 'inventory.csv'), 'utf8');
  } catch {
    csv = '';
  }
  return {
    exit: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    csv,
  };
}

function writeTask(
  bvDir: string,
  bucket: 'new' | 'stage' | 'done',
  filename: string,
  frontmatter: Record<string, string>,
  taskName: string
): void {
  const fmLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const content = `---\n${fmLines}\n---\n# Task: ${taskName}\n\nbody\n`;
  writeFileSync(join(bvDir, 'tasks', bucket, filename), content);
}

function writeReport(bvDir: string, filename: string): void {
  writeFileSync(
    join(bvDir, 'logs', 'worker-reports', filename),
    '---\nstatus: green\n---\n# Report\n'
  );
}

const HEADER =
  'task_id,task_name,prd_source,is_done,date_added,date_finished,iterations';

// ============================================================================
// inventory.ts (vendored regeneration script)
// ============================================================================

describe('inventory.ts', () => {
  it('happy path: emits header + sorted rows across all three buckets', () => {
    const tmp = withTempProject();
    try {
      writeTask(tmp.bvDir, 'new', 'T-00-2026-01-01.md', { status: 'new' }, 'name-zero');
      writeTask(
        tmp.bvDir,
        'stage',
        'T-01-2026-01-02.md',
        { status: 'stage', 'prd-source': 'docs/foo/foo.spec.v1.md' },
        'name-one'
      );
      writeTask(
        tmp.bvDir,
        'done',
        'T-02-2026-01-03.md',
        {
          status: 'done',
          'prd-source': 'docs/bar.spec.v2.md',
          'worker-reports': '[WR-01]',
        },
        'name-two'
      );
      writeReport(tmp.bvDir, 'WR-01-some-slug-2026-01-04.md');

      const result = runInventory(tmp.dir);
      expect(result.exit).toBe(0);
      expect(result.csv).toBe(
        [
          HEADER,
          'T-00,name-zero,,false,2026-01-01,,0',
          'T-01,name-one,foo.spec.v1,false,2026-01-02,,0',
          'T-02,name-two,bar.spec.v2,true,2026-01-03,2026-01-04,1',
          '',
        ].join('\n')
      );
    } finally {
      tmp.cleanup();
    }
  });

  it('NFR-2: blank prd_source when frontmatter lacks prd-source, no warning', () => {
    const tmp = withTempProject();
    try {
      writeTask(tmp.bvDir, 'new', 'T-00-2026-01-01.md', { status: 'new' }, 'name');
      const result = runInventory(tmp.dir);
      expect(result.exit).toBe(0);
      expect(result.csv).toContain('T-00,name,,false,2026-01-01,');
      expect(result.stderr).not.toMatch(/prd-source/);
    } finally {
      tmp.cleanup();
    }
  });

  it('NFR-3: done task with unresolvable WR-NN → blank date_finished, stderr warning, exit 0', () => {
    const tmp = withTempProject();
    try {
      writeTask(
        tmp.bvDir,
        'done',
        'T-05-2026-02-01.md',
        {
          status: 'done',
          'worker-reports': '[WR-99]',
        },
        'orphaned'
      );
      const result = runInventory(tmp.dir);
      expect(result.exit).toBe(0);
      expect(result.csv).toContain('T-05,orphaned,,true,2026-02-01,');
      expect(result.stderr).toMatch(/T-05.*WR-99 not found/);
    } finally {
      tmp.cleanup();
    }
  });

  it('FR-6: incremental rewrite preserves bytewise identity for unchanged rows', () => {
    const tmp = withTempProject();
    try {
      writeTask(tmp.bvDir, 'new', 'T-00-2026-01-01.md', { status: 'new' }, 'name-zero');
      writeTask(tmp.bvDir, 'new', 'T-01-2026-01-02.md', { status: 'new' }, 'name-one');

      const first = runInventory(tmp.dir);
      expect(first.exit).toBe(0);
      const firstCsv = first.csv;
      const firstBytes = Buffer.from(firstCsv);

      // Flip T-01 to done with a resolved WR.
      rmSync(join(tmp.bvDir, 'tasks', 'new', 'T-01-2026-01-02.md'));
      writeTask(
        tmp.bvDir,
        'done',
        'T-01-2026-01-02.md',
        {
          status: 'done',
          'worker-reports': '[WR-01]',
        },
        'name-one'
      );
      writeReport(tmp.bvDir, 'WR-01-the-slug-2026-01-05.md');

      const second = runInventory(tmp.dir);
      expect(second.exit).toBe(0);
      const secondBytes = Buffer.from(second.csv);

      // T-00 row must be bytewise identical between runs.
      const firstLines = firstCsv.split('\n');
      const secondLines = second.csv.split('\n');
      const t00First = firstLines.find((l) => l.startsWith('T-00,'));
      const t00Second = secondLines.find((l) => l.startsWith('T-00,'));
      expect(t00First).toBe(t00Second);
      expect(t00First).toBe('T-00,name-zero,,false,2026-01-01,,0');

      // T-01 row must have flipped to done with date_finished populated.
      const t01Second = secondLines.find((l) => l.startsWith('T-01,'));
      expect(t01Second).toBe('T-01,name-one,,true,2026-01-02,2026-01-05,1');

      // Sanity: the file did change between runs.
      expect(Buffer.compare(firstBytes, secondBytes)).not.toBe(0);
    } finally {
      tmp.cleanup();
    }
  });

  it('RFC 4180: quotes task names containing commas', () => {
    const tmp = withTempProject();
    try {
      writeTask(
        tmp.bvDir,
        'new',
        'T-00-2026-01-01.md',
        { status: 'new' },
        'name with, a comma'
      );
      const result = runInventory(tmp.dir);
      expect(result.exit).toBe(0);
      expect(result.csv).toContain('T-00,"name with, a comma",,false,2026-01-01,');
    } finally {
      tmp.cleanup();
    }
  });

  it('drops rows present in existing CSV but absent on disk, with a warning', () => {
    const tmp = withTempProject();
    try {
      // Pre-existing CSV references T-99 which has no on-disk file.
      writeFileSync(
        join(tmp.bvDir, 'inventory.csv'),
        [HEADER, 'T-99,old-task,,true,2025-01-01,2025-01-02', ''].join('\n')
      );
      writeTask(tmp.bvDir, 'new', 'T-00-2026-01-01.md', { status: 'new' }, 'fresh');

      const result = runInventory(tmp.dir);
      expect(result.exit).toBe(0);
      expect(result.csv).not.toContain('T-99');
      expect(result.csv).toContain('T-00,fresh,,false,2026-01-01,');
      expect(result.stderr).toMatch(/T-99.*dropping row/);
    } finally {
      tmp.cleanup();
    }
  });
});
