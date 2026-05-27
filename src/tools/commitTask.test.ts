jest.mock('fs/promises');

import { access, readdir, readFile, writeFile } from 'fs/promises';
import {
  deriveSlug,
  formatReportFilename,
  formatWrId,
  makeCommitTask,
  nextWrIteration,
  todayYmd,
} from './commitTask';
import { buildPaths } from '../paths';

const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const PATHS = buildPaths('/abs/proj');
const commitTask = makeCommitTask(PATHS);

const FIXED_DATE = '2026-05-07';

describe('formatWrId', () => {
  it('zero-pads single-digit iterations', () => {
    expect(formatWrId(1)).toBe('WR-01');
    expect(formatWrId(9)).toBe('WR-09');
  });

  it('preserves two-digit iterations', () => {
    expect(formatWrId(12)).toBe('WR-12');
  });
});

describe('nextWrIteration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 1 when the directory is empty', async () => {
    mockReaddir.mockResolvedValue([]);

    expect(await nextWrIteration(PATHS.reports)).toBe(1);
    expect(mockReaddir).toHaveBeenCalledWith(PATHS.reports);
  });

  it('returns 1 when the directory does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    expect(await nextWrIteration(PATHS.reports)).toBe(1);
  });

  it('returns max + 1 across contiguous WR-NN files', async () => {
    mockReaddir.mockResolvedValue([
      'WR-01-add-auth-2026-05-07.md',
      'WR-02-add-auth-2026-05-08.md',
    ]);

    expect(await nextWrIteration(PATHS.reports)).toBe(3);
  });

  it('returns max + 1 across non-contiguous WR-NN files and ignores non-matching entries', async () => {
    mockReaddir.mockResolvedValue([
      'WR-04-foo-2026-05-07.md',
      'WR-07-bar-2026-05-08.md',
      'unrelated.txt',
      'README.md',
    ]);

    expect(await nextWrIteration(PATHS.reports)).toBe(8);
  });

  it('handles three-digit WR-NN values', async () => {
    mockReaddir.mockResolvedValue([
      'WR-99-x-2026-05-07.md',
      'WR-100-y-2026-05-08.md',
    ]);

    expect(await nextWrIteration(PATHS.reports)).toBe(101);
  });

  it('rethrows non-ENOENT errors', async () => {
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    mockReaddir.mockRejectedValue(eperm);

    await expect(nextWrIteration(PATHS.reports)).rejects.toThrow('EPERM');
  });
});

describe('todayYmd', () => {
  it('formats the local calendar date, not UTC', () => {
    // 2026-05-18 23:30 local. For any operator west of UTC the UTC date here
    // is already 2026-05-19, but todayYmd must report the local day.
    expect(todayYmd(new Date(2026, 4, 18, 23, 30, 0))).toBe('2026-05-18');
  });

  it('zero-pads single-digit month and day', () => {
    expect(todayYmd(new Date(2026, 0, 5, 9, 0, 0))).toBe('2026-01-05');
  });
});

describe('formatReportFilename', () => {
  it('joins WR-NN, slug, and date with hyphens', () => {
    expect(formatReportFilename(1, 'add-auth', '2026-05-07')).toBe(
      'WR-01-add-auth-2026-05-07.md'
    );
  });
});

describe('deriveSlug', () => {
  it('extracts a slug from "# Task: <name>"', () => {
    expect(deriveSlug('# Task: Add Auth\n\nbody')).toBe('add-auth');
  });

  it('lowercases and slugifies multi-word headings', () => {
    expect(deriveSlug('# Task: Implement OAuth Flow!\n')).toBe(
      'implement-oauth-flow'
    );
  });

  it('falls back to "task" when no heading', () => {
    expect(deriveSlug('no heading here')).toBe('task');
  });

  it('falls back to "task" on null content', () => {
    expect(deriveSlug(null)).toBe('task');
  });
});

describe('commitTask (factory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies the report exists and updates the task frontmatter atomically', async () => {
    mockAccess.mockResolvedValue(undefined as unknown as void);
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue(
      '---\nstatus: stage\nworker-reports: []\n---\n# Task: add auth\n\nbody\n'
    );
    mockWriteFile.mockResolvedValue(undefined as unknown as void);

    const result = await commitTask({
      taskId: 'T-01',
      iteration: 1,
      slug: 'add-auth',
      date: FIXED_DATE,
    });

    expect(result.wrId).toBe('WR-01');
    expect(result.reportPath).toMatch(
      /bv_orchestration[\\/]logs[\\/]worker-reports[\\/]WR-01-add-auth-2026-05-07\.md$/
    );

    expect(mockAccess).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [taskPath, updatedRaw] = mockWriteFile.mock.calls[0];
    expect(taskPath).toMatch(
      /bv_orchestration[\\/]tasks[\\/]stage[\\/]T-01-2026-05-07\.md$/
    );
    expect(String(updatedRaw)).toContain('worker-reports:');
    expect(String(updatedRaw)).toContain("- WR-01");
  });

  it('appends to an existing worker-reports array', async () => {
    mockAccess.mockResolvedValue(undefined as unknown as void);
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue(
      "---\nstatus: stage\nworker-reports:\n  - WR-01\n---\n# Task: add auth\n\nbody\n"
    );
    mockWriteFile.mockResolvedValue(undefined as unknown as void);

    await commitTask({
      taskId: 'T-01',
      iteration: 2,
      slug: 'add-auth',
      date: FIXED_DATE,
    });

    const [, updatedRaw] = mockWriteFile.mock.calls[0];
    const text = String(updatedRaw);
    expect(text).toContain('- WR-01');
    expect(text).toContain('- WR-02');
  });

  it('throws "Report not found" when access rejects with ENOENT', async () => {
    const err = Object.assign(new Error('enoent'), { code: 'ENOENT' });
    mockAccess.mockRejectedValue(err);

    await expect(
      commitTask({
        taskId: 'T-01',
        iteration: 1,
        slug: 'missing',
        date: FIXED_DATE,
      })
    ).rejects.toThrow(/Report not found/);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('throws when the task spec is not in stage/', async () => {
    mockAccess.mockResolvedValue(undefined as unknown as void);
    mockReaddir.mockResolvedValue([]);

    await expect(
      commitTask({
        taskId: 'T-01',
        iteration: 1,
        slug: 'add-auth',
        date: FIXED_DATE,
      })
    ).rejects.toThrow(/Task spec not in stage/);
  });

  it('rejects task_id path traversal', async () => {
    await expect(
      commitTask({
        taskId: '../evil',
        iteration: 1,
        slug: 'x',
        date: FIXED_DATE,
      })
    ).rejects.toThrow(/invalid task_id/i);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('rejects iterations of zero or negative', async () => {
    await expect(
      commitTask({ taskId: 'T-01', iteration: 0, slug: 'x', date: FIXED_DATE })
    ).rejects.toThrow(/invalid iteration/i);
    await expect(
      commitTask({ taskId: 'T-01', iteration: -1, slug: 'x', date: FIXED_DATE })
    ).rejects.toThrow(/invalid iteration/i);
  });

  it('rejects a non-integer iteration', async () => {
    await expect(
      commitTask({ taskId: 'T-01', iteration: 1.5, slug: 'x', date: FIXED_DATE })
    ).rejects.toThrow(/invalid iteration/i);
  });
});
