jest.mock('fs/promises');

import { readdir, readFile } from 'fs/promises';
import { makeFetchTask } from './fetchTask';
import { buildPaths } from '../paths';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockReaddir = readdir as unknown as jest.Mock;

const PATHS = buildPaths('/abs/proj');
const readTaskFile = makeFetchTask(PATHS);

describe('readTaskFile (factory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns body and empty metadata when the file has no frontmatter', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue('# task body');

    const result = await readTaskFile('T-01');

    expect(result.body).toBe('# task body');
    expect(result.metadata).toEqual({});
    expect(result.filename).toBe('T-01-2026-05-07.md');
    const [calledPath] = mockReadFile.mock.calls[0];
    expect(calledPath).toMatch(
      /bv_orchestration[\\/]tasks[\\/]new[\\/]T-01-2026-05-07\.md$/
    );
  });

  it('parses idempotency_check from frontmatter and strips it from the body', async () => {
    mockReaddir.mockResolvedValue(['T-02-2026-05-07.md']);
    mockReadFile.mockResolvedValue(
      '---\nidempotency_check: true\n---\n# task body\n'
    );

    const result = await readTaskFile('T-02');

    expect(result.metadata.idempotency_check).toBe(true);
    expect(result.body).not.toContain('idempotency_check');
    expect(result.body).toContain('# task body');
  });

  it('preserves unknown frontmatter keys via passthrough', async () => {
    mockReaddir.mockResolvedValue(['T-03-2026-05-07.md']);
    mockReadFile.mockResolvedValue(
      '---\nstatus: new\nworker-reports: []\n---\n# body\n'
    );

    const result = await readTaskFile('T-03');

    expect(result.metadata).toMatchObject({ status: 'new' });
  });

  it('rejects non-boolean idempotency_check', async () => {
    mockReaddir.mockResolvedValue(['T-04-2026-05-07.md']);
    mockReadFile.mockResolvedValue('---\nidempotency_check: "yes"\n---\nbody\n');

    await expect(readTaskFile('T-04')).rejects.toThrow();
  });

  it('throws "Task not found" when no file matches the T-NN prefix', async () => {
    mockReaddir.mockResolvedValue(['T-99-2026-05-07.md']);

    await expect(readTaskFile('T-01')).rejects.toThrow(/Task not found/);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('throws "Task not found" when the new dir does not exist', async () => {
    const err = Object.assign(new Error('enoent'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(err);

    await expect(readTaskFile('T-01')).rejects.toThrow(/Task not found/);
  });

  it('rejects task_id containing "../" (path traversal)', async () => {
    await expect(readTaskFile('../evil')).rejects.toThrow(/invalid task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('rejects an empty task_id', async () => {
    await expect(readTaskFile('')).rejects.toThrow(/invalid task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('rejects task_id containing "/"', async () => {
    await expect(readTaskFile('sub/dir')).rejects.toThrow(/invalid task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });
});
