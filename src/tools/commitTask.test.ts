jest.mock('fs/promises');

import { access } from 'fs/promises';
import { verifyReportFile } from './commitTask';

const mockAccess = access as jest.MockedFunction<typeof access>;

describe('verifyReportFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return the expected path when the file is readable', async () => {
    mockAccess.mockResolvedValue(undefined);

    const result = await verifyReportFile('my-task', 1);

    expect(mockAccess).toHaveBeenCalledTimes(1);
    expect(result).toMatch(/tasks[\\/]staged[\\/]my-task-01\.md$/);
  });

  it('should throw "Report not found" when access rejects with ENOENT', async () => {
    const err = Object.assign(new Error('enoent'), { code: 'ENOENT' });
    mockAccess.mockRejectedValue(err);

    await expect(verifyReportFile('missing', 1)).rejects.toThrow(
      /Report not found.*missing-01\.md/
    );
  });

  it('should re-throw non-ENOENT filesystem errors verbatim', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockAccess.mockRejectedValue(err);

    await expect(verifyReportFile('locked', 1)).rejects.toThrow('permission denied');
  });

  it('should reject task_id containing "../" (path traversal)', async () => {
    await expect(verifyReportFile('../evil', 1)).rejects.toThrow(/invalid task_id/i);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('should reject an empty task_id', async () => {
    await expect(verifyReportFile('', 1)).rejects.toThrow(/invalid task_id/i);
    await expect(verifyReportFile('   ', 1)).rejects.toThrow(/invalid task_id/i);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('should reject task_id containing "/"', async () => {
    await expect(verifyReportFile('sub/dir', 1)).rejects.toThrow(/invalid task_id/i);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('should reject an iteration of zero or negative', async () => {
    await expect(verifyReportFile('task', 0)).rejects.toThrow(/invalid iteration/i);
    await expect(verifyReportFile('task', -1)).rejects.toThrow(/invalid iteration/i);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('should reject a non-integer iteration', async () => {
    await expect(verifyReportFile('task', 1.5)).rejects.toThrow(/invalid iteration/i);
    await expect(verifyReportFile('task', Number.NaN)).rejects.toThrow(/invalid iteration/i);
    await expect(verifyReportFile('task', Number.POSITIVE_INFINITY)).rejects.toThrow(
      /invalid iteration/i
    );
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('should zero-pad the iteration to two digits in the filename', async () => {
    mockAccess.mockResolvedValue(undefined);

    const low = await verifyReportFile('task', 1);
    const mid = await verifyReportFile('task', 9);
    const high = await verifyReportFile('task', 12);

    expect(low).toMatch(/task-01\.md$/);
    expect(mid).toMatch(/task-09\.md$/);
    expect(high).toMatch(/task-12\.md$/);
  });
});
