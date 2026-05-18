const mockQuery = jest.fn();
const mockCreateSdkMcpServer = jest.fn(
  (config: { name: string; tools: unknown[] }) => ({
    type: 'sdk',
    name: config.name,
    tools: config.tools,
    instance: {},
  })
);
const mockTool = jest.fn(
  (
    name: string,
    description: string,
    inputSchema: unknown,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
  ) => ({ name, description, inputSchema, handler })
);

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockTool,
}));
jest.mock('fs/promises');

import { PassThrough } from 'node:stream';
import {
  access,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'fs/promises';
import { MemorySaver } from '@langchain/langgraph';
import { buildBetterVibesGraph } from '../graph/graph';
import { ORCHESTRATOR_MCP_SERVER_NAME } from '../graph/orchestrator';
import { buildPaths } from '../paths';
import { parseArgs, runCli, THREAD_ID } from './runner';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const PATHS = buildPaths('/abs/proj');
const TASK_FILE = 'T-01-2026-05-07.md';
const TASK_ID = 'T-01';
const TASK_BODY =
  '---\nstatus: new\nworker-reports: []\n---\n# Task: smoke\n\nbody';
const STAGED_TASK_BODY =
  '---\nstatus: stage\nworker-reports: []\n---\n# Task: smoke\n\nbody';

// ============================================================================
// Test Helpers
// ============================================================================

const ENOENT = Object.assign(new Error('enoent'), { code: 'ENOENT' });

type SdkToolShape = {
  name: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown
  ) => Promise<unknown>;
};

type QueryParams = {
  prompt: string;
  options: {
    mcpServers?: Record<string, { tools: SdkToolShape[] }>;
    canUseTool?: (
      tool: string,
      input: Record<string, unknown>
    ) => Promise<unknown>;
  };
};

function queryInvokingTool(
  toolName: string,
  args: Record<string, unknown>
): (params: QueryParams) => AsyncGenerator<unknown, void> {
  return function mockedQuery(params) {
    const server = params.options.mcpServers?.[ORCHESTRATOR_MCP_SERVER_NAME];
    if (!server) throw new Error('test misconfigured: no orchestrator server');
    const matched = server.tools.find((t) => t.name === toolName);
    if (!matched) throw new Error(`test misconfigured: tool ${toolName}`);
    return (async function* () {
      await matched.handler(args, {});
    })();
  };
}

function setupFs() {
  mockReaddir.mockImplementation((p) => {
    const s = String(p);
    if (s.includes('tasks/new')) return Promise.resolve([TASK_FILE]);
    if (s.includes('tasks/stage')) return Promise.resolve([TASK_FILE]);
    if (s.includes('tasks/done')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  mockReadFile.mockImplementation((p) => {
    const s = String(p);
    if (s.includes('tasks/stage')) return Promise.resolve(STAGED_TASK_BODY);
    return Promise.resolve(TASK_BODY);
  });
  mockWriteFile.mockResolvedValue(undefined as unknown as void);
  mockRename.mockResolvedValue(undefined as unknown as void);
  mockAccess.mockImplementation((p) => {
    const s = String(p);
    // Done targets must appear absent for assertTargetFree
    if (s.includes('tasks/done')) return Promise.reject(ENOENT);
    // Anything else (include files, reports) succeeds by default
    return Promise.resolve();
  });
}

function makeStdio() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  stdout.on('data', (c: Buffer) => stdoutChunks.push(c.toString('utf8')));
  stderr.on('data', (c: Buffer) => stderrChunks.push(c.toString('utf8')));
  return {
    stdin,
    stdout,
    stderr,
    getStdoutLines: () =>
      stdoutChunks
        .join('')
        .split('\n')
        .filter((l) => l.length > 0),
    getStderr: () => stderrChunks.join(''),
  };
}

function makeDeps(opts: {
  argv: string[];
  stdio: ReturnType<typeof makeStdio>;
  checkpointer: MemorySaver;
}) {
  return {
    argv: opts.argv,
    stdin: opts.stdio.stdin,
    stdout: opts.stdio.stdout,
    stderr: opts.stdio.stderr,
    buildGraph: () => buildBetterVibesGraph(PATHS),
    checkpointer: opts.checkpointer,
    paths: PATHS,
  };
}

async function waitFor<T>(
  fn: () => T | null | undefined,
  timeoutMs = 1000
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ============================================================================
// parseArgs
// ============================================================================

describe('parseArgs', () => {
  it('accepts `run <T-NN>`', () => {
    expect(parseArgs(['run', 'T-01'])).toEqual({
      mode: 'run',
      task_id: 'T-01',
      include: [],
    });
  });

  it('accepts `resume`', () => {
    expect(parseArgs(['resume'])).toEqual({ mode: 'resume' });
  });

  it('rejects `run` with no task id', () => {
    expect(parseArgs(['run'])).toMatchObject({ mode: 'invalid' });
  });

  it('rejects `run` with an empty task id', () => {
    expect(parseArgs(['run', ''])).toMatchObject({ mode: 'invalid' });
  });

  it('rejects an unknown subcommand', () => {
    expect(parseArgs(['tea'])).toMatchObject({ mode: 'invalid' });
  });

  it('rejects extra arguments to `resume`', () => {
    expect(parseArgs(['resume', 'oops'])).toMatchObject({ mode: 'invalid' });
  });

  it('accepts `run <T-NN> --include <single-path>`', () => {
    expect(parseArgs(['run', 'T-01', '--include', 'src/foo.ts'])).toEqual({
      mode: 'run',
      task_id: 'T-01',
      include: ['src/foo.ts'],
    });
  });

  it('accepts `run <T-NN> --include <p1> <p2> <p3>`', () => {
    expect(
      parseArgs(['run', 'T-01', '--include', 'a.ts', 'b.ts', 'c.ts'])
    ).toEqual({
      mode: 'run',
      task_id: 'T-01',
      include: ['a.ts', 'b.ts', 'c.ts'],
    });
  });

  it('rejects `--include` with no following paths', () => {
    expect(
      parseArgs(['run', 'T-01', '--include'])
    ).toMatchObject({ mode: 'invalid' });
  });

  it('rejects unknown flags after the task id', () => {
    expect(
      parseArgs(['run', 'T-01', '--frobnicate', 'x'])
    ).toMatchObject({ mode: 'invalid' });
  });

  it('rejects `--include` on resume', () => {
    expect(
      parseArgs(['resume', '--include', 'x'])
    ).toMatchObject({ mode: 'invalid' });
  });
});

// ============================================================================
// runCli — protocol errors
// ============================================================================

describe('runCli — protocol errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 2 and writes usage on malformed argv', async () => {
    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['nope'],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(2);
    expect(stdio.getStderr()).toMatch(/Usage:/);
    expect(stdio.getStdoutLines()).toEqual([]);
  });

  it('returns 2 on resume with invalid JSON on stdin', async () => {
    const stdio = makeStdio();
    stdio.stdin.write('not json\n');
    stdio.stdin.end();
    const exit = await runCli(
      makeDeps({
        argv: ['resume'],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(2);
    expect(stdio.getStderr()).toMatch(/invalid ResumeInput JSON/);
  });

  it('returns 2 on resume with no stdin input', async () => {
    const stdio = makeStdio();
    stdio.stdin.end();
    const exit = await runCli(
      makeDeps({
        argv: ['resume'],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(2);
    expect(stdio.getStderr()).toMatch(/expected ResumeInput JSON/);
  });
});

// ============================================================================
// runCli — run mode
// ============================================================================

describe('runCli — run mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFs();
  });

  it('emits a done event when the orchestrator calls mark_done', async () => {
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));
    const stdio = makeStdio();
    const checkpointer = new MemorySaver();
    const exit = await runCli(
      makeDeps({
        argv: ['run', TASK_ID],
        stdio,
        checkpointer,
      })
    );
    expect(exit).toBe(0);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: TASK_ID, iterations: 0 },
    ]);
    expect(checkpointer.storage[THREAD_ID]).toBeDefined();
  });

  it('emits a human_review interrupted event when the worker completes', async () => {
    mockQuery
      .mockImplementationOnce(
        queryInvokingTool('delegate_to_worker', {
          instructions: 'do the thing',
        })
      )
      .mockImplementationOnce(() =>
        (async function* () {
          // Worker SDK drains silently — commitNode picks up the "written" file.
        })()
      );

    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['run', TASK_ID],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );

    expect(exit).toBe(0);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      {
        status: 'interrupted',
        interrupt: 'human_review',
        task_id: TASK_ID,
        iteration: 1,
        report_path: expect.stringMatching(/WR-01-smoke-\d{4}-\d{2}-\d{2}\.md$/),
      },
    ]);
  });

  it('emits a clarify interrupted event when the orchestrator calls request_clarification', async () => {
    mockQuery.mockImplementation(
      queryInvokingTool('request_clarification', {
        question: 'JWT or sessions?',
      })
    );
    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['run', TASK_ID],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(0);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      {
        status: 'interrupted',
        interrupt: 'clarify',
        task_id: TASK_ID,
        question: 'JWT or sessions?',
      },
    ]);
  });

  it('reads --include files and renders them in the orchestrator prompt', async () => {
    mockReadFile.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('include-a.ts'))
        return Promise.resolve('export const A = 1;');
      if (s.endsWith('include-b.ts'))
        return Promise.resolve('export const B = 2;');
      if (s.includes('tasks/stage')) return Promise.resolve(STAGED_TASK_BODY);
      return Promise.resolve(TASK_BODY);
    });

    let capturedPrompt: string | null = null;
    mockQuery.mockImplementation((params: QueryParams) => {
      capturedPrompt = params.prompt;
      const server =
        params.options.mcpServers?.[ORCHESTRATOR_MCP_SERVER_NAME];
      if (!server) throw new Error('no orchestrator server');
      const tool = server.tools.find((t) => t.name === 'mark_done');
      if (!tool) throw new Error('no mark_done');
      return (async function* () {
        await tool.handler({}, {});
      })();
    });

    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: [
          'run',
          TASK_ID,
          '--include',
          'include-a.ts',
          'include-b.ts',
        ],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );

    expect(exit).toBe(0);
    expect(capturedPrompt).not.toBeNull();
    const prompt = capturedPrompt as unknown as string;
    expect(prompt).toContain('Included files:');
    expect(prompt).toContain('include-a.ts');
    expect(prompt).toContain('export const A = 1;');
    expect(prompt).toContain('include-b.ts');
    expect(prompt).toContain('export const B = 2;');
    expect(prompt.indexOf('export const A = 1;')).toBeLessThan(
      prompt.indexOf('export const B = 2;')
    );
  });

  it('exits 1 with a clear error when --include references a missing file', async () => {
    mockReadFile.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('does-not-exist.ts')) {
        const err: NodeJS.ErrnoException = Object.assign(
          new Error('ENOENT'),
          { code: 'ENOENT' }
        );
        return Promise.reject(err);
      }
      if (s.includes('tasks/stage')) return Promise.resolve(STAGED_TASK_BODY);
      return Promise.resolve(TASK_BODY);
    });

    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['run', TASK_ID, '--include', 'does-not-exist.ts'],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );

    expect(exit).toBe(1);
    expect(stdio.getStderr()).toMatch(/Include file not found: does-not-exist\.ts/);
    expect(stdio.getStdoutLines()).toEqual([]);
  });
});

// ============================================================================
// runCli — resume mode
// ============================================================================

describe('runCli — resume mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFs();
  });

  async function primeToHumanReview(checkpointer: MemorySaver) {
    mockQuery
      .mockImplementationOnce(
        queryInvokingTool('delegate_to_worker', { instructions: 'do it' })
      )
      .mockImplementationOnce(() =>
        (async function* () {
          // worker drain
        })()
      );
    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({ argv: ['run', TASK_ID], stdio, checkpointer })
    );
    expect(exit).toBe(0);
  }

  it('greenlights the report, moves the task spec stage → done, and emits a done event', async () => {
    const checkpointer = new MemorySaver();
    await primeToHumanReview(checkpointer);

    mockQuery.mockReset();

    const stdio = makeStdio();
    stdio.stdin.write('{"decision":"greenlight"}\n');
    stdio.stdin.end();

    const exit = await runCli(
      makeDeps({ argv: ['resume'], stdio, checkpointer })
    );

    expect(exit).toBe(0);
    // pushTaskNode should rename stage→done at least once.
    const renameCalls = mockRename.mock.calls.filter(([from, to]) => {
      const f = String(from);
      const t = String(to);
      return f.includes('tasks/stage') && t.includes('tasks/done');
    });
    expect(renameCalls.length).toBeGreaterThan(0);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: TASK_ID, iterations: 1 },
    ]);
    expect(checkpointer.storage[THREAD_ID]).toBeUndefined();
    const remainingWriteThreads = Object.keys(checkpointer.writes).filter(
      (k) => {
        try {
          return (JSON.parse(k) as unknown[])[0] === THREAD_ID;
        } catch {
          return false;
        }
      }
    );
    expect(remainingWriteThreads).toEqual([]);
  });

  it('redlights with feedback and loops back to the orchestrator', async () => {
    const checkpointer = new MemorySaver();
    await primeToHumanReview(checkpointer);

    mockQuery.mockReset();
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));

    const stdio = makeStdio();
    stdio.stdin.write(
      '{"decision":"redlight","feedback":"missing acceptance criteria"}\n'
    );
    stdio.stdin.end();

    const exit = await runCli(
      makeDeps({ argv: ['resume'], stdio, checkpointer })
    );
    expect(exit).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: TASK_ID, iterations: 1 },
    ]);
    expect(checkpointer.storage[THREAD_ID]).toBeDefined();
  });

  it('accepts pretty-printed multi-line resume JSON', async () => {
    const checkpointer = new MemorySaver();
    await primeToHumanReview(checkpointer);

    mockQuery.mockReset();
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));

    const prettyJson = JSON.stringify(
      { decision: 'redlight', feedback: 'missing acceptance criteria' },
      null,
      2
    );
    expect(prettyJson).toContain('\n');

    const stdio = makeStdio();
    stdio.stdin.write(`${prettyJson}\n`);
    stdio.stdin.end();

    const exit = await runCli(
      makeDeps({ argv: ['resume'], stdio, checkpointer })
    );
    expect(exit).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: TASK_ID, iterations: 1 },
    ]);
  });

  it('emits no_active_task and exits 2 when the checkpoint has nothing to resume', async () => {
    const checkpointer = new MemorySaver();

    const stdio = makeStdio();
    stdio.stdin.write('{"decision":"greenlight"}\n');
    stdio.stdin.end();

    const exit = await runCli(
      makeDeps({ argv: ['resume'], stdio, checkpointer })
    );
    expect(exit).toBe(2);
    expect(mockQuery).not.toHaveBeenCalled();
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      {
        status: 'no_active_task',
        message: expect.stringMatching(/no in-progress task to resume/),
      },
    ]);
  });
});

// ============================================================================
// runCli — permission bridge
// ============================================================================

describe('runCli — permission bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFs();
  });

  async function workerCanUseToolScenario(opts: {
    toolToRequest: string;
    humanDecision: 'allow' | 'deny' | 'allow_session';
  }) {
    let capturedResult: unknown = null;
    mockQuery
      .mockImplementationOnce(
        queryInvokingTool('delegate_to_worker', { instructions: 'do it' })
      )
      .mockImplementationOnce((params: QueryParams) => {
        return (async function* () {
          if (params.options.canUseTool) {
            capturedResult = await params.options.canUseTool(
              opts.toolToRequest,
              { url: 'http://example.test' }
            );
          }
        })();
      });

    const stdio = makeStdio();
    const checkpointer = new MemorySaver();

    const invokeP = runCli(
      makeDeps({ argv: ['run', TASK_ID], stdio, checkpointer })
    );

    const request = await waitFor(() => {
      const lines = stdio.getStdoutLines();
      const reqLine = lines.find((l) => l.includes('permission_request'));
      return reqLine ? JSON.parse(reqLine) : null;
    });

    expect(request.kind).toBe('permission_request');
    expect(request.tool).toBe(opts.toolToRequest);
    expect(typeof request.request_id).toBe('string');

    stdio.stdin.write(
      JSON.stringify({
        kind: 'permission_response',
        request_id: request.request_id,
        decision: opts.humanDecision,
      }) + '\n'
    );

    const exit = await invokeP;
    stdio.stdin.end();
    return { capturedResult, exit, stdio };
  }

  it('bridges an allow decision to the gate', async () => {
    const { capturedResult, exit } = await workerCanUseToolScenario({
      toolToRequest: 'WebFetch',
      humanDecision: 'allow',
    });
    expect(exit).toBe(0);
    expect(capturedResult).toMatchObject({ behavior: 'allow' });
  });

  it('bridges a deny decision to the gate', async () => {
    const { capturedResult, exit } = await workerCanUseToolScenario({
      toolToRequest: 'WebFetch',
      humanDecision: 'deny',
    });
    expect(exit).toBe(0);
    expect(capturedResult).toMatchObject({ behavior: 'deny' });
  });
});

// ============================================================================
// runCli — error paths
// ============================================================================

describe('runCli — error paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFs();
  });

  it('surfaces a non-interrupt SDK error on stderr with exit 1', async () => {
    mockQuery.mockImplementation(() =>
      (async function* () {
        throw new Error('simulated SDK failure');
      })()
    );
    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['run', TASK_ID],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(1);
    expect(stdio.getStderr()).toMatch(/simulated SDK failure/);
    expect(stdio.getStdoutLines()).toEqual([]);
  });
});
