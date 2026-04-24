import { END, START, StateGraph } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { BaseMessage } from '@langchain/core/messages';
import { buildWorkerPrompt } from '../prompts/worker';
import { verifyReportFile } from '../tools/commitTask';
import type { PermissionGate } from './permissionGate';
import { GraphState, type GraphStateType } from './state';

// ============================================================================
// Helpers
// ============================================================================

/** Tool names the SDK is allowed to use — matches the Claude Code default set. */
export const CLAUDE_CODE_DEFAULT_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
];

/**
 * Returns the string content of the most recent AIMessage in the conversation.
 *
 * @param messages - The full `state.messages` array. The worker treats the
 *   last AIMessage as the orchestrator's synthesized hand-off — that is the
 *   only thing the SDK is given.
 *
 * @remarks
 * Throws if no AIMessage exists (graph-logic bug — worker entered without an
 * orchestrator turn) or if the AIMessage's content is not a plain string
 * (v1 assumption; the orchestrator currently produces string content only).
 */
export function extractInstructions(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg._getType() === 'ai') {
      if (typeof msg.content !== 'string') {
        throw new Error('AIMessage instructions must be a string');
      }
      return msg.content;
    }
  }
  throw new Error('no AI message to use as instructions');
}

// ============================================================================
// Nodes
// ============================================================================

/**
 * Increments the iteration counter on entry to the worker subgraph.
 *
 * @param state - Graph state. `iteration` may be null (first entry) or any
 *   positive integer (redlight re-entry).
 *
 * @remarks
 * Monotonic increment handles both cases uniformly per spec §4.3.
 */
export async function initNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  return { iteration: (state.iteration ?? 0) + 1 };
}

/**
 * Invokes the Claude Agent SDK to execute the task and write a report.
 *
 * @param state - Graph state. Reads `messages` (for orchestrator
 *   instructions), `task_id`, `task_content`, and `iteration`.
 *
 * @param config - LangGraph runnable config. A `PermissionGate` may be
 *   injected under `config.configurable.permissionGate`; when present the
 *   gate handles tool-permission decisions interactively.
 *
 * @remarks
 * Drains the SDK's async iterator; the agent runs to completion as a side
 * effect. No state is written — the report file on disk is the output,
 * verified downstream by `commitNode`. With a gate injected the SDK uses
 * `permissionMode: 'default'` and defers each tool decision to the gate's
 * `canUseTool`. Without a gate we fall back to `dontAsk` — allowlisted
 * tools run silently, others are denied outright.
 */
export async function execNode(
  state: GraphStateType,
  config?: RunnableConfig
): Promise<Partial<GraphStateType>> {
  const instructions = extractInstructions(state.messages);
  const prompt = buildWorkerPrompt({
    instructions,
    taskContent: state.task_content!,
    taskId: state.task_id!,
    iteration: state.iteration!,
  });
  const gate = config?.configurable?.permissionGate as
    | PermissionGate
    | undefined;
  const iterator = query({
    prompt,
    options: gate
      ? {
          cwd: process.cwd(),
          allowedTools: CLAUDE_CODE_DEFAULT_TOOLS,
          canUseTool: gate.canUseTool,
          permissionMode: 'default',
        }
      : {
          cwd: process.cwd(),
          allowedTools: CLAUDE_CODE_DEFAULT_TOOLS,
          permissionMode: 'dontAsk',
        },
  });
  for await (const _ of iterator) {
    // Drain: let the SDK run to completion. Messages are not mirrored into
    // state.messages — the worker is opaque to the orchestrator's thread.
  }
  return {};
}

/**
 * Verifies the worker wrote a report at the expected path and records the
 * path in state.
 *
 * @param state - Graph state. Reads `task_id` and `iteration`; writes
 *   `report_path`.
 *
 * @remarks
 * Delegates to `verifyReportFile`. Errors (missing file, invalid input,
 * filesystem failure) propagate to the parent graph per the fail-loud
 * policy (§1.2).
 */
export async function commitNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const report_path = await verifyReportFile(state.task_id!, state.iteration!);
  return { report_path };
}

// ============================================================================
// Subgraph
// ============================================================================

/**
 * Compiled worker subgraph — `init` → `exec` → `commit`.
 *
 * @remarks
 * Embedded into the parent graph by the orchestrator task. Nodes throw on
 * any failure; there is no retry or recovery in v1.
 */
export const workerSubgraph = new StateGraph(GraphState)
  .addNode('init', initNode)
  .addNode('exec', execNode)
  .addNode('commit', commitNode)
  .addEdge(START, 'init')
  .addEdge('init', 'exec')
  .addEdge('exec', 'commit')
  .addEdge('commit', END)
  .compile();
