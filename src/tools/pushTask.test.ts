jest.mock('fs/promises');

import { access, readdir, rename } from 'fs/promises';
import { pushReports } from './pushTask';

const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockRename = rename as jest.MockedFunction<typeof rename>;

const ENOENT = Object.assign(new Error('enoent'), { code: 'ENOENT' });

describe('pushReports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: all `done/` targets are free (access rejects with ENOENT).
    mockAccess.mockRejectedValue(ENOENT);
    mockRename.mockResolvedValue(undefined);
  });

  it('should move a single matching iteration and return its new done path', async () => {
    mockReaddir.mockResolvedValue(['task-one-01.md']);

    const result = await pushReports('task-one');

    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/tasks[\\/]done[\\/]task-one-01\.md$/);
    const [from, to] = mockRename.mock.calls[0];
    expect(from).toMatch(/tasks[\\/]staged[\\/]task-one-01\.md$/);
    expect(to).toMatch(/tasks[\\/]done[\\/]task-one-01\.md$/);
  });

  it('should move multiple iterations in ascending order', async () => {
    mockReaddir.mockResolvedValue(['task-02.md', 'task-01.md', 'task-03.md']);

    const result = await pushReports('task');

    expect(mockRename).toHaveBeenCalledTimes(3);
    expect(result[0]).toMatch(/task-01\.md$/);
    expect(result[1]).toMatch(/task-02\.md$/);
    expect(result[2]).toMatch(/task-03\.md$/);
  });

  it('should ignore files that do not match the iteration pattern', async () => {
    mockReaddir.mockResolvedValue([
      'task-01.md',
      'task.md',
      'task-01.txt',
      'other-01.md',
      'README.md',
    ]);

    const result = await pushReports('task');

    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/task-01\.md$/);
  });

  it('should not match files whose base is a longer prefix of task_id', async () => {
    mockReaddir.mockResolvedValue([
      'task-extended-01.md',
      'task-extended-02.md',
    ]);

    await expect(pushReports('task')).rejects.toThrow(/no staged reports/i);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should throw "no staged reports" when staged/ is empty', async () => {
    mockReaddir.mockResolvedValue([]);

    await expect(pushReports('task')).rejects.toThrow(
      /no staged reports.*task/i
    );
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should throw "no staged reports" when nothing matches', async () => {
    mockReaddir.mockResolvedValue(['other-01.md', 'README.md']);

    await expect(pushReports('task')).rejects.toThrow(/no staged reports/i);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should throw "push target exists" when the done/ target is present', async () => {
    mockReaddir.mockResolvedValue(['task-01.md']);
    mockAccess.mockResolvedValue(undefined); // target exists

    await expect(pushReports('task')).rejects.toThrow(/push target exists/i);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should leave prior moves in place when a later rename fails', async () => {
    mockReaddir.mockResolvedValue(['task-01.md', 'task-02.md', 'task-03.md']);
    mockRename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error('permission denied'), { code: 'EACCES' })
      );

    await expect(pushReports('task')).rejects.toThrow('permission denied');
    expect(mockRename).toHaveBeenCalledTimes(2);
    const firstMove = mockRename.mock.calls[0];
    expect(firstMove[0]).toMatch(/task-01\.md$/);
  });

  it('should reject invalid task_id without reading the directory', async () => {
    await expect(pushReports('')).rejects.toThrow(/invalid task_id/i);
    await expect(pushReports('sub/dir')).rejects.toThrow(/invalid task_id/i);
    await expect(pushReports('../evil')).rejects.toThrow(/invalid task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });
});
