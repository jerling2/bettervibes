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

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../prompts/orchestrator';
import {
  ORCHESTRATOR_ALLOWED_TOOLS,
  ORCHESTRATOR_MCP_SERVER_NAME,
  ORCHESTRATOR_MODEL,
  buildOrchestratorPrompt,
  orchestratorNode,
} from './orchestrator';
import type { GraphStateType } from './state';

// ============================================================================
// Helpers
// ============================================================================

const baseState: GraphStateType = {
  messages: [],
  baseline_messages: [],
  accumulated_notes: [],
  task_id: 'smoke',
  task_content: '# Task\n\nDo the smoke thing.',
  task_metadata: null,
  iteration: null,
  report_path: null,
  terminal_intent: null,
  human_verdict: null,
  included_files: [],
};

type SdkToolShape = {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (
    args: Record<string, unknown>,
    extra: unknown
  ) => Promise<unknown>;
};

type QueryParams = {
  prompt: string;
  options: {
    mcpServers?: Record<string, { tools: SdkToolShape[] }>;
    [key: string]: unknown;
  };
};

/**
 * Returns a `query()` mock implementation that, when invoked, finds the named
 * tool in the passed MCP server config and calls its handler with `args` — the
 * same path Claude would follow when emitting a tool_use. The mocked iterator
 * then drains empty, so the orchestrator node proceeds to inspect `ctx.intent`.
 */
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

function emptyQuery(): AsyncGenerator<unknown, void> {
  return (async function* () {
    // drain without invoking any tool
  })();
}

function throwingQuery(message: string): AsyncGenerator<unknown, void> {
  return (async function* () {
    throw new Error(message);
  })();
}

// ============================================================================
// Tests
// ============================================================================

describe('orchestratorNode — query() options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));
  });

  it('should call query with model ORCHESTRATOR_MODEL and ORCHESTRATOR_SYSTEM_PROMPT', async () => {
    await orchestratorNode(baseState);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [params] = mockQuery.mock.calls[0];
    expect(params.options.model).toBe(ORCHESTRATOR_MODEL);
    expect(params.options.systemPrompt).toBe(ORCHESTRATOR_SYSTEM_PROMPT);
  });

  it('should disable all built-in tools via tools: []', async () => {
    await orchestratorNode(baseState);

    const [params] = mockQuery.mock.calls[0];
    expect(params.options.tools).toEqual([]);
  });

  it('should allowlist exactly the three orchestrator MCP tool names', async () => {
    await orchestratorNode(baseState);

    const [params] = mockQuery.mock.calls[0];
    expect(params.options.allowedTools).toEqual(ORCHESTRATOR_ALLOWED_TOOLS);
  });

  it('should set permissionMode to dontAsk', async () => {
    await orchestratorNode(baseState);

    const [params] = mockQuery.mock.calls[0];
    expect(params.options.permissionMode).toBe('dontAsk');
  });

  it('should register the orchestrator MCP server with the three terminal tools', async () => {
    await orchestratorNode(baseState);

    const [params] = mockQuery.mock.calls[0];
    expect(params.options.mcpServers).toHaveProperty(
      ORCHESTRATOR_MCP_SERVER_NAME
    );
    const server = params.options.mcpServers[ORCHESTRATOR_MCP_SERVER_NAME];
    const toolNames = server.tools.map((t: SdkToolShape) => t.name).sort();
    expect(toolNames).toEqual([
      'delegate_to_worker',
      'mark_done',
      'request_clarification',
    ]);
  });

  it('should pass a string prompt built from graph state', async () => {
    await orchestratorNode(baseState);

    const [params] = mockQuery.mock.calls[0];
    expect(typeof params.prompt).toBe('string');
    expect(params.prompt).toContain('smoke');
    expect(params.prompt).toContain('Do the smoke thing.');
  });
});

describe('orchestratorNode — terminal intent capture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should capture delegate_to_worker intent', async () => {
    mockQuery.mockImplementation(
      queryInvokingTool('delegate_to_worker', { instructions: 'do the thing' })
    );

    const result = await orchestratorNode(baseState);

    expect(result).toEqual({
      terminal_intent: { kind: 'delegate', instructions: 'do the thing' },
    });
  });

  it('should capture request_clarification intent', async () => {
    mockQuery.mockImplementation(
      queryInvokingTool('request_clarification', { question: 'what scope?' })
    );

    const result = await orchestratorNode(baseState);

    expect(result).toEqual({
      terminal_intent: { kind: 'clarify', question: 'what scope?' },
    });
  });

  it('should capture mark_done intent', async () => {
    mockQuery.mockImplementation(queryInvokingTool('mark_done', {}));

    const result = await orchestratorNode(baseState);

    expect(result).toEqual({ terminal_intent: { kind: 'done' } });
  });
});

describe('orchestratorNode — failure modes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw when the SDK loop drains without a terminal tool call', async () => {
    mockQuery.mockReturnValue(emptyQuery());

    await expect(orchestratorNode(baseState)).rejects.toThrow(
      /orchestrator ended turn without a terminal tool call/i
    );
  });

  it('should propagate errors thrown by the SDK iterator', async () => {
    mockQuery.mockReturnValue(throwingQuery('sdk boom'));

    await expect(orchestratorNode(baseState)).rejects.toThrow('sdk boom');
  });
});

describe('buildOrchestratorPrompt', () => {
  it('should include task_id, task_content, and iteration', () => {
    const prompt = buildOrchestratorPrompt({
      ...baseState,
      iteration: 2,
    });

    expect(prompt).toContain('smoke');
    expect(prompt).toContain('Do the smoke thing.');
    expect(prompt).toContain('2');
  });

  it('should render recent activity when messages exist', () => {
    const prompt = buildOrchestratorPrompt({
      ...baseState,
      messages: [
        new AIMessage('prior orchestrator instructions'),
        new HumanMessage('redlight: missing validation'),
      ],
    });

    expect(prompt).toContain('prior orchestrator instructions');
    expect(prompt).toContain('redlight: missing validation');
  });

  it('should indicate no recent activity on the first turn', () => {
    const prompt = buildOrchestratorPrompt(baseState);

    expect(prompt).toMatch(/no recent activity|first turn|none/i);
  });

  it('omits the included-files section when no files are included', () => {
    const prompt = buildOrchestratorPrompt(baseState);
    expect(prompt).not.toContain('Included files:');
    expect(prompt).not.toContain('<file path=');
  });

  it('renders <file> blocks in argv order when included_files is non-empty', () => {
    const prompt = buildOrchestratorPrompt({
      ...baseState,
      included_files: [
        { path: '/abs/a.ts', content: 'export const A = 1;' },
        { path: '/abs/b.ts', content: 'export const B = 2;' },
      ],
    });

    expect(prompt).toContain('Included files:');
    expect(prompt).toContain('<file path="/abs/a.ts">');
    expect(prompt).toContain('export const A = 1;');
    expect(prompt).toContain('<file path="/abs/b.ts">');
    expect(prompt).toContain('export const B = 2;');
    expect(prompt.indexOf('/abs/a.ts')).toBeLessThan(prompt.indexOf('/abs/b.ts'));
  });
});
