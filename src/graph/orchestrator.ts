import {
  createSdkMcpServer,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { BaseMessage } from '@langchain/core/messages';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../prompts/orchestrator';
import type { IncludedFile } from '../tools/includeFiles';
import type { GraphStateType, TerminalIntent } from './state';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Mutable context shared across the orchestrator's MCP terminal-tool handlers
 * for a single invocation. The node creates one per call; each terminal-tool
 * handler closes over it and writes its captured intent when invoked.
 */
interface OrchestratorMcpContext {
  intent: TerminalIntent | null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Anthropic model the orchestrator runs on. */
export const ORCHESTRATOR_MODEL = 'claude-sonnet-4-6';

/** MCP server name under which the orchestrator registers its terminal tools. */
export const ORCHESTRATOR_MCP_SERVER_NAME = 'bettervibes-orchestrator';

/**
 * Fully-qualified MCP tool names the orchestrator is allowed to call.
 *
 * @remarks
 * Format follows the SDK's MCP tool naming convention:
 * `mcp__{server}__{tool}`. Passed to `query()` as `allowedTools` so the
 * orchestrator's SDK session auto-allows exactly these three, and nothing
 * else, under `permissionMode: 'dontAsk'`.
 */
export const ORCHESTRATOR_ALLOWED_TOOLS = [
  `mcp__${ORCHESTRATOR_MCP_SERVER_NAME}__delegate_to_worker`,
  `mcp__${ORCHESTRATOR_MCP_SERVER_NAME}__request_clarification`,
  `mcp__${ORCHESTRATOR_MCP_SERVER_NAME}__mark_done`,
];

/**
 * Serializes graph state into the orchestrator's per-turn user prompt.
 *
 * @param state - Graph state. Reads `task_id`, `task_content`, `iteration`,
 *   `report_path`, and `messages`. Does not read `terminal_intent` — the
 *   orchestrator's prior decisions are expected to manifest in `messages`
 *   (as `AIMessage`s) and their outcomes (worker summaries, human verdicts)
 *   as downstream messages that the parent graph synthesizes.
 *
 * @remarks
 * Option B from the conversation-continuity decision: each turn receives a
 * fresh state snapshot in the user prompt rather than relying on SDK session
 * continuity across process exits. `messages` is rendered as flat text with a
 * role prefix rather than fed through any SDK conversation channel.
 */
export function buildOrchestratorPrompt(state: GraphStateType): string {
  const iteration = state.iteration ?? 'none yet';
  const reportPath = state.report_path ?? 'none';
  const activity = renderRecentActivity(state.messages);
  const includedSection = renderIncludedFiles(state.included_files);
  return `Current task state:

- Task ID: ${state.task_id ?? 'unset'}
- Iteration: ${iteration}
- Latest worker report path: ${reportPath}

Task content:
---
${state.task_content ?? '(no task content loaded)'}
---
${includedSection}
Recent activity:
${activity}

Call exactly one terminal tool to decide the next action.
`;
}

/**
 * Renders the user-supplied `--include` files as a labeled block of
 * `<file path="…">` elements, or an empty string when no files were
 * included.
 *
 * @param files - The resolved `state.included_files` array.
 *
 * @remarks
 * Returns `''` (not a placeholder line) when empty so the orchestrator's
 * prompt has no inert "Included files: none" header to scan past. When
 * non-empty, returns a leading-and-trailing-newline block so the surrounding
 * template stays readable regardless of presence.
 */
function renderIncludedFiles(files: IncludedFile[]): string {
  if (files.length === 0) return '';
  const blocks = files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join('\n\n');
  return `\nIncluded files:\n${blocks}\n`;
}

/**
 * Renders `state.messages` as a flat, role-prefixed block for inclusion in the
 * orchestrator's per-turn user prompt.
 *
 * @param messages - The full `state.messages` array. Ordering is preserved.
 *
 * @remarks
 * Returns the literal string `(no recent activity — this is the first turn)`
 * when empty so the orchestrator's prompt always has a concrete value here
 * rather than a structural gap.
 */
function renderRecentActivity(messages: BaseMessage[]): string {
  if (messages.length === 0) {
    return '(no recent activity — this is the first turn)';
  }
  return messages
    .map((msg) => {
      const role = msg._getType();
      const content =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `[${role}] ${content}`;
    })
    .join('\n\n');
}

/**
 * Minimal result shape the SDK expects from an MCP tool handler. Mirrors
 * `CallToolResult` from `@modelcontextprotocol/sdk` — duplicated here so we
 * do not take on the MCP package as a direct dependency just for a type.
 */
interface TerminalToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Thin wrapper over the SDK's `tool()` factory that short-circuits the zod
 * v3/v4 type collision.
 *
 * @param name - MCP tool name (unprefixed).
 * @param description - Tool description surfaced to the model.
 * @param inputSchema - Zod raw shape defining the tool's input.
 * @param handler - Runtime handler; receives the parsed args.
 *
 * @remarks
 * The SDK's `tool()` is typed against `ZodRawShape | Zod4RawShape`. The root
 * `node_modules` hoists zod v4, so both arms of the union resolve to v4
 * types — but `packages/langgraph` has a nested zod v3 (pinned for
 * `@langchain/core` compatibility), so `z.string()` at runtime produces a v3
 * value that does not structurally satisfy v4's `$ZodType`. The SDK accepts
 * either shape at runtime; only the TypeScript inference is confused.
 * Casting through `any` at this boundary is the same pattern used for the
 * now-retired `defineTool` helper.
 */
function sdkTool<Args extends Record<string, unknown>>(
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: (args: Args) => Promise<TerminalToolResult>
): SdkMcpToolDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return tool(name, description, inputSchema as any, handler as any);
}

/**
 * Builds the orchestrator's in-process MCP server hosting the three terminal
 * tools.
 *
 * @param ctx - Mutable intent-capture context. Each tool handler writes into
 *   `ctx.intent` when invoked; the orchestrator node reads it after the SDK
 *   loop drains.
 *
 * @remarks
 * All three tools are terminal — calling one indicates the orchestrator has
 * decided its next action. The handlers return short acknowledgment strings
 * so the SDK's agent loop has a sensible tool_result to end the turn on.
 */
function buildOrchestratorMcpServer(ctx: OrchestratorMcpContext) {
  return createSdkMcpServer({
    name: ORCHESTRATOR_MCP_SERVER_NAME,
    tools: [
      sdkTool<{ instructions: string }>(
        'delegate_to_worker',
        'Hand off task execution to the worker subgraph with synthesized instructions. Ends your turn.',
        { instructions: z.string().min(1) },
        async ({ instructions }) => {
          ctx.intent = { kind: 'delegate', instructions };
          return {
            content: [{ type: 'text', text: 'Delegating to worker.' }],
          };
        }
      ),
      sdkTool<{ question: string }>(
        'request_clarification',
        'Ask the human a clarifying question. Ends your turn until the human responds.',
        { question: z.string().min(1) },
        async ({ question }) => {
          ctx.intent = { kind: 'clarify', question };
          return {
            content: [{ type: 'text', text: 'Awaiting clarification.' }],
          };
        }
      ),
      sdkTool<Record<string, never>>(
        'mark_done',
        'Signal that the task is fully complete. Ends the session.',
        {},
        async () => {
          ctx.intent = { kind: 'done' };
          return { content: [{ type: 'text', text: 'Done.' }] };
        }
      ),
    ],
  });
}

/**
 * Best-effort extraction of the last assistant text seen in the SDK stream.
 *
 * @param messages - The full stream of `SDKMessage`s drained from the
 *   `query()` iterator, in emission order.
 *
 * @remarks
 * Used only for the fail-loud error message when the orchestrator ends a turn
 * without a terminal tool call. Returns an empty string if no assistant text
 * was observed. Defensive against content-block shapes we have not modeled
 * explicitly.
 */
function extractLastAssistantText(messages: SDKMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== 'assistant') continue;
    const content = (msg as { message?: { content?: unknown } }).message
      ?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j] as { type?: string; text?: string };
      if (block?.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }
  return '';
}

// ============================================================================
// Node
// ============================================================================

/**
 * Orchestrator node. Runs a single SDK `query()` turn with a custom MCP server
 * exposing three terminal tools; reads the captured intent from the server's
 * context after the loop drains; returns a state update setting
 * `terminal_intent`.
 *
 * @param state - Graph state. Read-only; `terminal_intent` is the only field
 *   returned in the update.
 *
 * @remarks
 * Fail-loud policy (§1.2): if the SDK loop ends without a terminal tool being
 * called, throws with the last assistant text excerpt to aid diagnosis.
 * The orchestrator's contract is "every turn ends with exactly one terminal
 * tool call"; this check enforces it.
 */
export async function orchestratorNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const ctx: OrchestratorMcpContext = { intent: null };
  const server = buildOrchestratorMcpServer(ctx);
  const prompt = buildOrchestratorPrompt(state);

  const iterator = query({
    prompt,
    options: {
      model: ORCHESTRATOR_MODEL,
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      tools: [],
      mcpServers: { [ORCHESTRATOR_MCP_SERVER_NAME]: server },
      allowedTools: ORCHESTRATOR_ALLOWED_TOOLS,
      permissionMode: 'dontAsk',
    },
  });

  const observed: SDKMessage[] = [];
  for await (const msg of iterator) {
    observed.push(msg);
  }

  if (ctx.intent === null) {
    const lastText = extractLastAssistantText(observed);
    throw new Error(
      `orchestrator ended turn without a terminal tool call. ` +
        `Last assistant text: "${lastText.slice(0, 200)}"`
    );
  }

  return { terminal_intent: ctx.intent };
}
