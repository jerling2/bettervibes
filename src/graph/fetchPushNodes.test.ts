jest.mock('fs/promises');

import {
  access,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'fs/promises';
import { makeFetchPushNodes } from './fetchPushNodes';
import { buildPaths } from '../paths';
import type { GraphStateType } from './state';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockRename = rename as jest.MockedFunction<typeof rename>;

const PATHS = buildPaths('/abs/proj');
const { fetchTaskNode, pushTaskNode } = makeFetchPushNodes(PATHS);

const ENOENT = Object.assign(new Error('enoent'), { code: 'ENOENT' });

const baseState: GraphStateType = {
  messages: [],
  baseline_messages: [],
  accumulated_notes: [],
  task_id: 'T-01',
  task_content: null,
  task_metadata: null,
  iteration: null,
  report_path: null,
  terminal_intent: null,
  human_verdict: null,
  included_files: [],
};

describe('fetchTaskNode (factory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
    mockRename.mockResolvedValue(undefined as unknown as void);
  });

  it('reads the task spec from tasks/new/T-NN-* and populates state', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue('# Task: add auth\n\nbody');

    const result = await fetchTaskNode(baseState);

    expect(result.task_content).toContain('# Task: add auth');
    expect(result.task_metadata).toEqual({});
    const [calledPath] = mockReadFile.mock.calls[0];
    expect(calledPath).toMatch(
      /bv_orchestration[\\/]tasks[\\/]new[\\/]T-01-2026-05-07\.md$/
    );
  });

  it('moves the spec to tasks/stage and flips status to stage', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue(
      '---\nstatus: new\n---\n# Task: add auth\n\nbody'
    );

    await fetchTaskNode(baseState);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [writePath, writtenRaw] = mockWriteFile.mock.calls[0];
    expect(writePath).toMatch(
      /bv_orchestration[\\/]tasks[\\/]new[\\/]T-01-2026-05-07\.md$/
    );
    expect(String(writtenRaw)).toContain('status: stage');
    expect(mockRename).toHaveBeenCalledTimes(1);
    const [from, to] = mockRename.mock.calls[0];
    expect(from).toMatch(
      /bv_orchestration[\\/]tasks[\\/]new[\\/]T-01-2026-05-07\.md$/
    );
    expect(to).toMatch(
      /bv_orchestration[\\/]tasks[\\/]stage[\\/]T-01-2026-05-07\.md$/
    );
  });

  it('throws when task_id is null', async () => {
    await expect(
      fetchTaskNode({ ...baseState, task_id: null })
    ).rejects.toThrow(/task_id/i);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('throws "Task not found" when no file matches the prefix', async () => {
    mockReaddir.mockResolvedValue(['T-99-2026-05-07.md']);

    await expect(fetchTaskNode(baseState)).rejects.toThrow(/Task not found/);
  });
});

describe('pushTaskNode (factory)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.mockRejectedValue(ENOENT);
    mockRename.mockResolvedValue(undefined as unknown as void);
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
    mockReadFile.mockResolvedValue(
      '---\nstatus: stage\n---\n# Task: add auth\n'
    );
  });

  it('moves the task spec from stage/ to done/', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);

    const result = await pushTaskNode(baseState);

    expect(result).toEqual({});
    expect(mockRename).toHaveBeenCalledTimes(1);
    const [from, to] = mockRename.mock.calls[0];
    expect(from).toMatch(
      /bv_orchestration[\\/]tasks[\\/]stage[\\/]T-01-2026-05-07\.md$/
    );
    expect(to).toMatch(
      /bv_orchestration[\\/]tasks[\\/]done[\\/]T-01-2026-05-07\.md$/
    );
  });

  it('flips frontmatter status from stage to done', async () => {
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);

    await pushTaskNode(baseState);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, writtenRaw] = mockWriteFile.mock.calls[0];
    expect(String(writtenRaw)).toContain('status: done');
  });

  it('throws when task_id is null', async () => {
    await expect(
      pushTaskNode({ ...baseState, task_id: null })
    ).rejects.toThrow(/task_id/i);
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('throws when no spec is in stage/', async () => {
    mockReaddir.mockResolvedValue([]);

    await expect(pushTaskNode(baseState)).rejects.toThrow(
      /Task spec not in stage/
    );
  });
});
