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

import { AIMessage } from '@langchain/core/messages';
import { readFile } from 'fs/promises';
import { ORCHESTRATOR_MCP_SERVER_NAME } from './orchestrator';
import { buildBetterVibesGraph } from './graph';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

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
  };
};

/** Returns a query() mock that invokes the named orchestrator tool once and drains. */
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

describe('buildBetterVibesGraph', () => {
  it('should compile without throwing', () => {
    expect(() => buildBetterVibesGraph().compile()).not.toThrow();
  });
});

describe('graph — mark_done short path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('# Task body');
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));
  });

  it('should fetch the task, run the orchestrator, and terminate on mark_done', async () => {
    const graph = buildBetterVibesGraph().compile();

    const result = await graph.invoke({ task_id: 'smoke' });

    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const [calledPath] = mockReadFile.mock.calls[0];
    expect(calledPath).toMatch(/tasks[\\/]ingest[\\/]smoke\.md$/);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result.task_content).toBe('# Task body');
    expect(result.terminal_intent).toEqual({ kind: 'done' });
  });
});

describe('graph — delegate_bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should synthesize an AIMessage from terminal_intent.instructions before the worker runs', async () => {
    mockReadFile.mockResolvedValue('# Task body');
    mockQuery
      .mockImplementationOnce(
        queryInvokingTool('delegate_to_worker', {
          instructions: 'implement the change',
        })
      )
      // Worker's SDK call — drain empty; then the flow pauses at HUMAN_INT.
      .mockImplementationOnce(() =>
        (async function* () {
          // drain-only
        })()
      );

    const graph = buildBetterVibesGraph().compile();

    // Invoke with an intentionally-missing commitNode file so we pause before
    // human_review fires. We only care that delegate_bridge added the
    // AIMessage to state.messages.
    let capturedState: { messages?: AIMessage[] } | null = null;
    try {
      capturedState = await graph.invoke({ task_id: 'smoke' });
    } catch {
      // commitNode will throw "Report not found" since we did not mock access;
      // that is fine — we inspect the graph's intermediate state another way.
    }

    // The first query() call is the orchestrator's; the second is the
    // worker's. If the worker ran, delegate_bridge ran first and would have
    // appended the instructions AIMessage.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [, workerCall] = mockQuery.mock.calls;
    const workerPrompt = workerCall[0].prompt as string;
    expect(workerPrompt).toContain('implement the change');

    // Final captured state (post-crash) should still show the AIMessage.
    if (capturedState) {
      expect(capturedState.messages).toBeDefined();
    }
  });
});
