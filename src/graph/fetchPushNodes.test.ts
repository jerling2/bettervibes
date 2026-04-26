jest.mock('fs/promises');

import { readFile, access, readdir, rename } from 'fs/promises';
import { fetchTaskNode, pushTaskNode } from './fetchPushNodes';
import type { GraphStateType } from './state';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockRename = rename as jest.MockedFunction<typeof rename>;

const ENOENT = Object.assign(new Error('enoent'), { code: 'ENOENT' });

const baseState: GraphStateType = {
  messages: [],
  baseline_messages: [],
  accumulated_notes: [],
  task_id: 'smoke',
  task_content: null,
  task_metadata: null,
  iteration: null,
  report_path: null,
  terminal_intent: null,
  human_verdict: null,
  included_files: [],
};

describe('fetchTaskNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should read tasks/ingest/{task_id}.md and populate task_content with empty metadata', async () => {
    mockReadFile.mockResolvedValue('# smoke task body');

    const result = await fetchTaskNode(baseState);

    expect(result).toEqual({
      task_content: '# smoke task body',
      task_metadata: {},
    });
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const [calledPath] = mockReadFile.mock.calls[0];
    expect(calledPath).toMatch(/tasks[\\/]ingest[\\/]smoke\.md$/);
  });

  it('should expose parsed frontmatter on task_metadata and strip it from task_content', async () => {
    mockReadFile.mockResolvedValue(
      '---\nidempotency_check: true\n---\n# smoke task body'
    );

    const result = await fetchTaskNode(baseState);

    expect(result.task_metadata).toEqual({ idempotency_check: true });
    expect(result.task_content).toContain('# smoke task body');
    expect(result.task_content).not.toContain('idempotency_check');
  });

  it('should throw when task_id is null', async () => {
    await expect(
      fetchTaskNode({ ...baseState, task_id: null })
    ).rejects.toThrow(/task_id/i);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('should propagate ENOENT from readTaskFile as "Task not found"', async () => {
    mockReadFile.mockRejectedValue(ENOENT);

    await expect(fetchTaskNode(baseState)).rejects.toThrow(
      /Task not found.*smoke\.md/
    );
  });
});

describe('pushTaskNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.mockRejectedValue(ENOENT);
    mockRename.mockResolvedValue(undefined);
  });

  it('should call pushReports with state.task_id and return an empty update', async () => {
    mockReaddir.mockResolvedValue(['smoke-01.md']);

    const result = await pushTaskNode(baseState);

    expect(result).toEqual({});
    expect(mockRename).toHaveBeenCalledTimes(1);
    const [from, to] = mockRename.mock.calls[0];
    expect(from).toMatch(/tasks[\\/]staged[\\/]smoke-01\.md$/);
    expect(to).toMatch(/tasks[\\/]done[\\/]smoke-01\.md$/);
  });

  it('should throw when task_id is null', async () => {
    await expect(
      pushTaskNode({ ...baseState, task_id: null })
    ).rejects.toThrow(/task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('should propagate "no staged reports" when nothing matches', async () => {
    mockReaddir.mockResolvedValue([]);

    await expect(pushTaskNode(baseState)).rejects.toThrow(/no staged reports/i);
  });
});
