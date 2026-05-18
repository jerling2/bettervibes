jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));
jest.mock('fs/promises');

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  access,
  readdir,
  readFile,
  writeFile,
} from 'fs/promises';
import { PermissionGate } from './permissionGate';
import {
  buildWorkerSubgraph,
  extractInstructions,
  makeInitNode,
} from './worker';
import { buildPaths } from '../paths';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const PATHS = buildPaths('/abs/proj');
const workerSubgraph = buildWorkerSubgraph(PATHS);

function makeEmptyQuery() {
  const gen: AsyncGenerator<unknown, void> = (async function* () {
    /* drain-only */
  })();
  return gen as unknown as ReturnType<typeof query>;
}

function makeThrowingQuery(message = 'sdk failure') {
  const gen: AsyncGenerator<unknown, void> = (async function* () {
    throw new Error(message);
  })();
  return gen as unknown as ReturnType<typeof query>;
}

const baseState = {
  messages: [new AIMessage('Do the thing carefully.')],
  baseline_messages: [],
  accumulated_notes: [],
  task_id: 'T-01',
  task_content: '# Task: add auth\n\nSteps here.',
  task_metadata: null,
  iteration: 1,
  report_path: null,
  terminal_intent: null,
  human_verdict: null,
  included_files: [],
};

describe('initNode', () => {
  const initNode = makeInitNode(PATHS);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 1 when the reports directory is empty', async () => {
    mockReaddir.mockResolvedValue([]);

    const result = await initNode({ ...baseState, iteration: null });

    expect(result).toEqual({ iteration: 1 });
    expect(mockReaddir).toHaveBeenCalledWith(PATHS.reports);
  });

  it('returns 1 when the reports directory does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValue(enoent);

    const result = await initNode({ ...baseState, iteration: null });

    expect(result).toEqual({ iteration: 1 });
  });

  it('returns max + 1 across contiguous WR-NN files', async () => {
    mockReaddir.mockResolvedValue([
      'WR-01-add-auth-2026-05-07.md',
      'WR-02-add-auth-2026-05-08.md',
    ]);

    const result = await initNode({ ...baseState, iteration: null });

    expect(result).toEqual({ iteration: 3 });
  });

  it('returns max + 1 across non-contiguous WR-NN files and ignores non-matching entries', async () => {
    mockReaddir.mockResolvedValue([
      'WR-04-foo-2026-05-07.md',
      'WR-07-bar-2026-05-08.md',
      'unrelated.txt',
      'README.md',
    ]);

    const result = await initNode({ ...baseState, iteration: null });

    expect(result).toEqual({ iteration: 8 });
  });
});

describe('extractInstructions', () => {
  it('should return content of the last AIMessage', () => {
    const messages = [
      new HumanMessage('human input'),
      new AIMessage('first ai'),
      new HumanMessage('more human'),
      new AIMessage('latest ai'),
    ];

    expect(extractInstructions(messages)).toBe('latest ai');
  });

  it('should throw when no AIMessage is present', () => {
    const messages = [new HumanMessage('only human')];

    expect(() => extractInstructions(messages)).toThrow(/no AI message/i);
  });
});

describe('workerSubgraph (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReturnValue(makeEmptyQuery());
    mockAccess.mockResolvedValue(undefined as unknown as void);
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue(
      '---\nstatus: stage\nworker-reports: []\n---\n# Task: add auth\n'
    );
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
  });

  it('builds a prompt referencing the WR-NN report path under bv_orchestration/logs/worker-reports/', async () => {
    await workerSubgraph.invoke({
      messages: [new AIMessage('orchestrator instructions')],
      task_id: 'T-01',
      task_content: '# Task: add auth',
      iteration: null,
    });

    const [args] = mockQuery.mock.calls[0];
    expect(args.prompt).toContain('orchestrator instructions');
    expect(args.prompt).toContain(
      'bv_orchestration/logs/worker-reports/WR-01-add-auth-'
    );
  });

  it('passes the resolved project root as the SDK cwd', async () => {
    await workerSubgraph.invoke({
      messages: [new AIMessage('orchestrator instructions')],
      task_id: 'T-01',
      task_content: '# Task: add auth',
      iteration: null,
    });

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.cwd).toBe(PATHS.root);
  });

  it('passes the Claude Code default allowedTools', async () => {
    await workerSubgraph.invoke({
      messages: [new AIMessage('orchestrator instructions')],
      task_id: 'T-01',
      task_content: '# Task: add auth',
      iteration: null,
    });

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.allowedTools).toEqual(
      expect.arrayContaining(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'])
    );
  });

  it('runs init → exec → commit and populates iteration + report_path', async () => {
    const result = await workerSubgraph.invoke({
      messages: [new AIMessage('orchestrator instructions')],
      task_id: 'T-01',
      task_content: '# Task: add auth',
      iteration: null,
    });

    expect(result.iteration).toBe(1);
    expect(result.report_path).toMatch(
      /bv_orchestration[\\/]logs[\\/]worker-reports[\\/]WR-01-add-auth-\d{4}-\d{2}-\d{2}\.md$/
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown by the SDK iterator', async () => {
    mockQuery.mockReturnValue(makeThrowingQuery('boom'));

    await expect(
      workerSubgraph.invoke({
        messages: [new AIMessage('orchestrator instructions')],
        task_id: 'T-01',
        task_content: '# Task: add auth',
        iteration: null,
      })
    ).rejects.toThrow('boom');
  });

  it('falls back to dontAsk and omits canUseTool when no gate is injected', async () => {
    await workerSubgraph.invoke({
      messages: [new AIMessage('orchestrator instructions')],
      task_id: 'T-01',
      task_content: '# Task: add auth',
      iteration: null,
    });

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.permissionMode).toBe('dontAsk');
    expect(args.options?.canUseTool).toBeUndefined();
  });

  it('wires the injected gate into the SDK call when invoked with configurable', async () => {
    const gate = new PermissionGate({
      allowlist: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
      emit: jest.fn(),
      context: () => ({ task_id: 'T-01', iteration: 1 }),
    });

    await workerSubgraph.invoke(
      {
        messages: [new AIMessage('orchestrator instructions')],
        task_id: 'T-01',
        task_content: '# Task: add auth',
        iteration: null,
      },
      { configurable: { permissionGate: gate } }
    );

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.canUseTool).toBe(gate.canUseTool);
    expect(args.options?.permissionMode).toBe('default');
  });
});
