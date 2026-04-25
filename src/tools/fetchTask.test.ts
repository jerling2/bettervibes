jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import { readTaskFile } from './fetchTask';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe('readTaskFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return body and empty metadata when the file has no frontmatter', async () => {
    mockReadFile.mockResolvedValue('# task body');

    const result = await readTaskFile('my-task');

    expect(result).toEqual({ body: '# task body', metadata: {} });
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const [calledPath] = mockReadFile.mock.calls[0];
    expect(calledPath).toMatch(/tasks[\\/]ingest[\\/]my-task\.md$/);
  });

  it('should parse idempotency_check from frontmatter and strip it from the body', async () => {
    mockReadFile.mockResolvedValue(
      '---\nidempotency_check: true\n---\n# task body\n'
    );

    const result = await readTaskFile('my-task');

    expect(result.metadata.idempotency_check).toBe(true);
    expect(result.body).not.toContain('idempotency_check');
    expect(result.body).toContain('# task body');
  });

  it('should preserve unknown frontmatter keys via passthrough', async () => {
    mockReadFile.mockResolvedValue(
      '---\ntask_id: hello\nfuture_field: 42\n---\n# body\n'
    );

    const result = await readTaskFile('my-task');

    expect(result.metadata).toMatchObject({ task_id: 'hello', future_field: 42 });
  });

  it('should reject non-boolean idempotency_check', async () => {
    mockReadFile.mockResolvedValue('---\nidempotency_check: "yes"\n---\nbody\n');

    await expect(readTaskFile('my-task')).rejects.toThrow();
  });

  it('should throw on malformed YAML frontmatter', async () => {
    mockReadFile.mockResolvedValue('---\nidempotency_check: true\n  bad: : :\n---\nbody\n');

    await expect(readTaskFile('my-task')).rejects.toThrow();
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
