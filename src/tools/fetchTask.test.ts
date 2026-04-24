jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import { readTaskFile } from './fetchTask';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe('readTaskFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return file contents when the task file exists', async () => {
    mockReadFile.mockResolvedValue('# task body');

    const result = await readTaskFile('my-task');

    expect(result).toBe('# task body');
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const [calledPath] = mockReadFile.mock.calls[0];
    expect(calledPath).toMatch(/tasks[\\/]ingest[\\/]my-task\.md$/);
  });

  it('should throw "Task not found" when fs raises ENOENT', async () => {
    const err = Object.assign(new Error('enoent'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);

    await expect(readTaskFile('missing')).rejects.toThrow(
      /Task not found.*missing\.md/
    );
  });

  it('should reject task_id containing "../" (path traversal)', async () => {
    await expect(readTaskFile('../evil')).rejects.toThrow(/invalid task_id/i);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('should reject an empty task_id', async () => {
    await expect(readTaskFile('')).rejects.toThrow(/invalid task_id/i);
    await expect(readTaskFile('   ')).rejects.toThrow(/invalid task_id/i);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('should reject task_id containing "/"', async () => {
    await expect(readTaskFile('sub/dir')).rejects.toThrow(/invalid task_id/i);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
