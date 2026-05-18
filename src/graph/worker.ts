import { END, START, StateGraph } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { BaseMessage } from '@langchain/core/messages';
import { buildWorkerPrompt } from '../prompts/worker';
import path from 'node:path';
import {
  deriveSlug,
  formatReportFilename,
  makeCommitTask,
  nextWrIteration,
  todayYmd,
} from '../tools/commitTask';
import type { PermissionGate } from './permissionGate';
import { GraphState, type GraphStateType } from './state';
import type { Paths } from '../paths';

// ============================================================================
// Helpers
// ============================================================================

export const CLAUDE_CODE_DEFAULT_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
];

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
 * Builds an `init` node bound to the resolved Paths. The node sets
 * `state.iteration` to the next project-global WR-NN integer by scanning
 * `paths.reports` on disk (`max(WR-NN found) + 1`, or `1` when the
 * directory is empty or missing).
 */
export function makeInitNode(paths: Paths) {
  return async function initNode(
    _state: GraphStateType
  ): Promise<Partial<GraphStateType>> {
    const iteration = await nextWrIteration(paths.reports);
    return { iteration };
  };
}

// ============================================================================
// Subgraph factory
// ============================================================================

/**
 * Builds the worker subgraph bound to the resolved Paths.
 */
export function buildWorkerSubgraph(paths: Paths) {
  const commitTask = makeCommitTask(paths);
  const initNode = makeInitNode(paths);

  async function execNode(
    state: GraphStateType,
    config?: RunnableConfig
  ): Promise<Partial<GraphStateType>> {
    const instructions = extractInstructions(state.messages);
    const slug = deriveSlug(state.task_content);
    const date = todayYmd();
    const reportFilename = formatReportFilename(
      state.iteration!,
      slug,
      date
    );
    const reportAbsPath = path.join(paths.reports, reportFilename);
    const prompt = buildWorkerPrompt({
      instructions,
      taskContent: state.task_content!,
      taskId: state.task_id!,
      iteration: state.iteration!,
      reportPath: reportAbsPath,
      metadata: state.task_metadata,
    });
    const gate = config?.configurable?.permissionGate as
      | PermissionGate
      | undefined;
    const iterator = query({
      prompt,
      options: gate
        ? {
            cwd: paths.root,
            allowedTools: CLAUDE_CODE_DEFAULT_TOOLS,
            canUseTool: gate.canUseTool,
            permissionMode: 'default',
          }
        : {
            cwd: paths.root,
            allowedTools: CLAUDE_CODE_DEFAULT_TOOLS,
            permissionMode: 'dontAsk',
          },
    });
    for await (const _ of iterator) {
      // drain
    }
    return {};
  }

  async function commitNode(
    state: GraphStateType
  ): Promise<Partial<GraphStateType>> {
    const slug = deriveSlug(state.task_content);
    const result = await commitTask({
      taskId: state.task_id!,
      iteration: state.iteration!,
      slug,
    });
    return { report_path: result.reportPath };
  }

  return new StateGraph(GraphState)
    .addNode('init', initNode)
    .addNode('exec', execNode)
    .addNode('commit', commitNode)
    .addEdge(START, 'init')
    .addEdge('init', 'exec')
    .addEdge('exec', 'commit')
    .addEdge('commit', END)
    .compile();
}
