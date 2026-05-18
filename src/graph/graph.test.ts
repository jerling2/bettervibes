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
import {
  access,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'fs/promises';
import { ORCHESTRATOR_MCP_SERVER_NAME } from './orchestrator';
import { buildBetterVibesGraph } from './graph';
import { buildPaths } from '../paths';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockReaddir = readdir as unknown as jest.Mock;
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockAccess = access as jest.MockedFunction<typeof access>;

const PATHS = buildPaths('/abs/proj');

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
  it('compiles without throwing', () => {
    expect(() => buildBetterVibesGraph(PATHS).compile()).not.toThrow();
  });
});

describe('graph — mark_done short path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue('# Task: add auth\n\nbody');
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
    mockRename.mockResolvedValue(undefined as unknown as void);
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));
  });

  it('fetches the task, runs the orchestrator, and terminates on mark_done', async () => {
    const graph = buildBetterVibesGraph(PATHS).compile();

    const result = await graph.invoke({ task_id: 'T-01' });

    expect(mockReadFile).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result.task_content).toContain('# Task: add auth');
    expect(result.terminal_intent).toEqual({ kind: 'done' });
  });
});

describe('graph — delegate_bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReaddir.mockResolvedValue(['T-01-2026-05-07.md']);
    mockReadFile.mockResolvedValue('# Task: add auth\n\nbody');
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
    mockRename.mockResolvedValue(undefined as unknown as void);
    mockAccess.mockRejectedValue(
      Object.assign(new Error('enoent'), { code: 'ENOENT' })
    );
  });

  it('synthesizes an AIMessage from terminal_intent.instructions before the worker runs', async () => {
    mockQuery
      .mockImplementationOnce(
        queryInvokingTool('delegate_to_worker', {
          instructions: 'implement the change',
        })
      )
      .mockImplementationOnce(() =>
        (async function* () {
          // worker drain
        })()
      );

    const graph = buildBetterVibesGraph(PATHS).compile();

    let capturedState: { messages?: AIMessage[] } | null = null;
    try {
      capturedState = await graph.invoke({ task_id: 'T-01' });
    } catch {
      // commitNode will throw "Report not found" since we did not let access succeed.
    }

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [, workerCall] = mockQuery.mock.calls;
    const workerPrompt = workerCall[0].prompt as string;
    expect(workerPrompt).toContain('implement the change');

    if (capturedState) {
      expect(capturedState.messages).toBeDefined();
    }
  });
});
