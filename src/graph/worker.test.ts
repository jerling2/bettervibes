jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));
jest.mock('fs/promises');

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { access } from 'fs/promises';
import { PermissionGate } from './permissionGate';
import {
  commitNode,
  execNode,
  extractInstructions,
  initNode,
  workerSubgraph,
} from './worker';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAccess = access as jest.MockedFunction<typeof access>;

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
  task_id: 'smoke',
  task_content: '# Task\n\nSteps here.',
  task_metadata: null,
  iteration: 1,
  report_path: null,
  terminal_intent: null,
  human_verdict: null,
  included_files: [],
};

describe('initNode', () => {
  it('should set iteration to 1 when currently null', async () => {
    const result = await initNode({ ...baseState, iteration: null });

    expect(result).toEqual({ iteration: 1 });
  });

  it('should increment iteration when already set', async () => {
    const result = await initNode({ ...baseState, iteration: 1 });

    expect(result).toEqual({ iteration: 2 });
  });

  it('should increment from a higher iteration', async () => {
    const result = await initNode({ ...baseState, iteration: 5 });

    expect(result).toEqual({ iteration: 6 });
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

describe('execNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReturnValue(makeEmptyQuery());
  });

  it('should invoke query with the prompt built from state', async () => {
    await execNode(baseState);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [args] = mockQuery.mock.calls[0];
    expect(args.prompt).toContain('Do the thing carefully.');
    expect(args.prompt).toContain('# Task');
    expect(args.prompt).toContain('smoke-01.md');
  });

  it('should pass the consumer project cwd to the SDK', async () => {
    await execNode(baseState);

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.cwd).toBe(process.cwd());
  });

  it('should pass the Claude Code default allowedTools', async () => {
    await execNode(baseState);

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.allowedTools).toEqual(
      expect.arrayContaining(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'])
    );
  });

  it('should drain the async iterator to completion', async () => {
    const next = jest.fn().mockResolvedValue({ done: true, value: undefined });
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]() {
        return this;
      },
      next,
    } as unknown as ReturnType<typeof query>);

    await execNode(baseState);

    expect(next).toHaveBeenCalled();
  });

  it('should propagate errors thrown by the SDK iterator', async () => {
    mockQuery.mockReturnValue(makeThrowingQuery('boom'));

    await expect(execNode(baseState)).rejects.toThrow('boom');
  });

  it('should return an empty partial state (no message updates)', async () => {
    const result = await execNode(baseState);

    expect(result).toEqual({});
  });

  it('should pass gate.canUseTool and permissionMode=default when a gate is injected', async () => {
    const gate = new PermissionGate({
      allowlist: ['Read'],
      emit: jest.fn(),
      context: () => ({ task_id: 'smoke', iteration: 1 }),
    });

    await execNode(baseState, { configurable: { permissionGate: gate } });

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.canUseTool).toBe(gate.canUseTool);
    expect(args.options?.permissionMode).toBe('default');
  });

  it('should fall back to dontAsk and omit canUseTool when no gate is injected', async () => {
    await execNode(baseState);

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.permissionMode).toBe('dontAsk');
    expect(args.options?.canUseTool).toBeUndefined();
  });
});

describe('commitNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call verifyReportFile and return report_path', async () => {
    mockAccess.mockResolvedValue(undefined);

    const result = await commitNode(baseState);

    expect(mockAccess).toHaveBeenCalledTimes(1);
    expect(result.report_path).toMatch(/tasks[\\/]staged[\\/]smoke-01\.md$/);
  });

  it('should propagate ENOENT from verifyReportFile as "Report not found"', async () => {
    mockAccess.mockRejectedValue(
      Object.assign(new Error('enoent'), { code: 'ENOENT' })
    );

    await expect(commitNode(baseState)).rejects.toThrow(/Report not found/i);
  });
});

describe('workerSubgraph (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReturnValue(makeEmptyQuery());
    mockAccess.mockResolvedValue(undefined);
  });

  it('should run init → exec → commit and populate iteration + report_path', async () => {
    const result = await workerSubgraph.invoke({
      messages: [new AIMessage('orchestrator instructions')],
      task_id: 'smoke',
      task_content: '# Task',
      iteration: null,
    });

    expect(result.iteration).toBe(1);
    expect(result.report_path).toMatch(/tasks[\\/]staged[\\/]smoke-01\.md$/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockAccess).toHaveBeenCalledTimes(1);
  });

  it('should wire the injected gate into the SDK call when invoked with configurable', async () => {
    const gate = new PermissionGate({
      allowlist: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
      emit: jest.fn(),
      context: () => ({ task_id: 'smoke', iteration: 1 }),
    });

    await workerSubgraph.invoke(
      {
        messages: [new AIMessage('orchestrator instructions')],
        task_id: 'smoke',
        task_content: '# Task',
        iteration: null,
      },
      { configurable: { permissionGate: gate } }
    );

    const [args] = mockQuery.mock.calls[0];
    expect(args.options?.canUseTool).toBe(gate.canUseTool);
    expect(args.options?.permissionMode).toBe('default');
  });
});
