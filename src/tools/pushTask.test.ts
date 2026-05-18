jest.mock('fs/promises');

import { access, readdir, readFile, rename, writeFile } from 'fs/promises';
import { makePushTask } from './pushTask';
import { buildPaths } from '../paths';

const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockRename = rename as jest.MockedFunction<typeof rename>;

const PATHS = buildPaths('/abs/proj');
const pushTaskSpec = makePushTask(PATHS);

const ENOENT = Object.assign(new Error('enoent'), { code: 'ENOENT' });

describe('pushTaskSpec (factory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.mockRejectedValue(ENOENT);
    mockRename.mockResolvedValue(undefined as unknown as void);
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
    mockReadFile.mockResolvedValue(
      '---\nstatus: stage\n---\n# Task: add auth\n'
    );
  });

  it('moves the task spec from stage to done and flips status to done', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);

    const result = await pushTaskSpec('T-01');

    expect(result).toMatch(
      /bv_orchestration[\\/]tasks[\\/]done[\\/]T-01-2026-05-07\.md$/
    );
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, updatedRaw] = mockWriteFile.mock.calls[0];
    expect(String(updatedRaw)).toContain('status: done');
    expect(String(updatedRaw)).not.toMatch(/^status: stage/m);
    expect(mockRename).toHaveBeenCalledTimes(1);
    const [from, to] = mockRename.mock.calls[0];
    expect(from).toMatch(
      /bv_orchestration[\\/]tasks[\\/]stage[\\/]T-01-2026-05-07\.md$/
    );
    expect(to).toMatch(
      /bv_orchestration[\\/]tasks[\\/]done[\\/]T-01-2026-05-07\.md$/
    );
  });

  it('throws when the spec is not in stage/', async () => {
    mockReaddir.mockResolvedValue([]);

    await expect(pushTaskSpec('T-01')).rejects.toThrow(
      /Task spec not in stage/
    );
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('throws "push target exists" when the done/ target is present', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockAccess.mockResolvedValue(undefined as unknown as void); // target exists

    await expect(pushTaskSpec('T-01')).rejects.toThrow(/push target exists/i);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('rejects invalid task_id without reading the directory', async () => {
    await expect(pushTaskSpec('')).rejects.toThrow(/invalid task_id/i);
    await expect(pushTaskSpec('sub/dir')).rejects.toThrow(/invalid task_id/i);
    await expect(pushTaskSpec('../evil')).rejects.toThrow(/invalid task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });
});
