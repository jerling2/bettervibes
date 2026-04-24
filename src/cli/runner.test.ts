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
import { access, readdir, readFile, rename } from 'fs/promises';
import { MemorySaver } from '@langchain/langgraph';
import { buildBetterVibesGraph } from '../graph/graph';
import { ORCHESTRATOR_MCP_SERVER_NAME } from '../graph/orchestrator';
import { parseArgs, runCli } from './runner';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;

// ============================================================================
// Test Helpers
// ============================================================================

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

/** Returns a query() mock that invokes one orchestrator terminal tool once. */
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

/** Builds a fresh PassThrough-stdin/stdout/stderr triple + sink arrays. */
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

/** Minimal deps builder — one MemorySaver shared across a test's runCli calls. */
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
    buildGraph: () => buildBetterVibesGraph(),
    checkpointer: opts.checkpointer,
  };
}

/** Polls until the given predicate returns true or the timeout elapses. */
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
  it('accepts `run <task-id>`', () => {
    expect(parseArgs(['run', 'smoke'])).toEqual({
      mode: 'run',
      task_id: 'smoke',
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
    mockReadFile.mockResolvedValue('# Smoke task body');
  });

  it('emits a done event when the orchestrator calls mark_done', async () => {
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));
    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['run', 'smoke'],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(0);
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: 'smoke', iterations: 0 },
    ]);
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
    mockAccess.mockResolvedValue(undefined as unknown as void);

    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({
        argv: ['run', 'smoke'],
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
        task_id: 'smoke',
        iteration: 1,
        report_path: expect.stringMatching(/smoke-01\.md$/),
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
        argv: ['run', 'smoke'],
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
        task_id: 'smoke',
        question: 'JWT or sessions?',
      },
    ]);
  });
});

// ============================================================================
// runCli — resume mode
// ============================================================================

describe('runCli — resume mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('# Smoke task body');
  });

  async function primeToHumanReview(checkpointer: MemorySaver) {
    // Run the graph once until it pauses at HUMAN_INT.
    mockQuery
      .mockImplementationOnce(
        queryInvokingTool('delegate_to_worker', { instructions: 'do it' })
      )
      .mockImplementationOnce(() =>
        (async function* () {
          // worker drain
        })()
      );
    mockAccess.mockResolvedValue(undefined as unknown as void);
    const stdio = makeStdio();
    const exit = await runCli(
      makeDeps({ argv: ['run', 'smoke'], stdio, checkpointer })
    );
    expect(exit).toBe(0);
  }

  it('greenlights the report, moves staged → done, and emits a done event', async () => {
    const checkpointer = new MemorySaver();
    await primeToHumanReview(checkpointer);

    // pushReports reads the staged dir and moves the single smoke report.
    // Target in tasks/done/ must appear absent (ENOENT) for assertTargetFree.
    mockReaddir.mockResolvedValue([
      'smoke-01.md',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockAccess.mockImplementation((p) => {
      const s = String(p);
      if (s.includes(`${'done'}/`) || s.endsWith(`/done/smoke-01.md`)) {
        const err: NodeJS.ErrnoException = Object.assign(
          new Error('ENOENT'),
          { code: 'ENOENT' }
        );
        return Promise.reject(err);
      }
      return Promise.resolve();
    });
    mockRename.mockResolvedValue(undefined as unknown as void);
    mockQuery.mockReset();

    // The resume stream won't re-enter the orchestrator on greenlight — the
    // graph goes straight to pushTask and ends.
    const stdio = makeStdio();
    stdio.stdin.write('{"decision":"greenlight"}\n');
    stdio.stdin.end();

    const exit = await runCli(
      makeDeps({ argv: ['resume'], stdio, checkpointer })
    );

    expect(exit).toBe(0);
    expect(mockRename).toHaveBeenCalled();
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: 'smoke', iterations: 1 },
    ]);
  });

  it('redlights with feedback and loops back to the orchestrator', async () => {
    const checkpointer = new MemorySaver();
    await primeToHumanReview(checkpointer);

    // On resume, the orchestrator re-enters and in this test picks `mark_done`
    // to keep the test path short while still proving the re-entry happened.
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
    expect(mockQuery).toHaveBeenCalledTimes(1); // re-entered the orchestrator once
    const lines = stdio.getStdoutLines().map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { status: 'done', task_id: 'smoke', iterations: 1 },
    ]);
  });
});

// ============================================================================
// runCli — permission bridge
// ============================================================================

describe('runCli — permission bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('# Smoke task body');
    mockAccess.mockResolvedValue(undefined as unknown as void);
  });

  async function workerCanUseToolScenario(opts: {
    toolToRequest: string;
    humanDecision: 'allow' | 'deny' | 'allow_session';
  }) {
    // delegate → worker runs, asks for a non-allowlisted tool → await response.
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
      makeDeps({ argv: ['run', 'smoke'], stdio, checkpointer })
    );

    // Wait for the permission_request line.
    const request = await waitFor(() => {
      const lines = stdio.getStdoutLines();
      const reqLine = lines.find((l) => l.includes('permission_request'));
      return reqLine ? JSON.parse(reqLine) : null;
    });

    expect(request.kind).toBe('permission_request');
    expect(request.tool).toBe(opts.toolToRequest);
    expect(typeof request.request_id).toBe('string');

    // Answer.
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
    mockReadFile.mockResolvedValue('# Smoke task body');
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
        argv: ['run', 'smoke'],
        stdio,
        checkpointer: new MemorySaver(),
      })
    );
    expect(exit).toBe(1);
    expect(stdio.getStderr()).toMatch(/simulated SDK failure/);
    expect(stdio.getStdoutLines()).toEqual([]);
  });
});
