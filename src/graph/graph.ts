import { END, START, StateGraph } from '@langchain/langgraph';
import { AIMessage } from '@langchain/core/messages';
import { routeTerminalIntent, routeVerdict } from './edges';
import { makeFetchPushNodes } from './fetchPushNodes';
import { clarifyInterruptNode, humanInterruptNode } from './interrupts';
import { orchestratorNode } from './orchestrator';
import { GraphState, type GraphStateType } from './state';
import { buildWorkerSubgraph } from './worker';
import type { Paths } from '../paths';

// ============================================================================
// Helpers
// ============================================================================

async function delegateBridgeNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  if (state.terminal_intent?.kind !== 'delegate') {
    throw new Error(
      'delegateBridgeNode: terminal_intent is not a delegate intent'
    );
  }
  return {
    messages: [new AIMessage(state.terminal_intent.instructions)],
  };
}

// ============================================================================
// Graph Assembly
// ============================================================================

/**
 * Builds the parent BetterVibes graph bound to the resolved Paths. Returns an
 * uncompiled `StateGraph` so callers (CLI, tests) can pass their own
 * checkpointer at compile time.
 */
export function buildBetterVibesGraph(paths: Paths) {
  const { fetchTaskNode, pushTaskNode } = makeFetchPushNodes(paths);
  const workerSubgraph = buildWorkerSubgraph(paths);

  return new StateGraph(GraphState)
    .addNode('fetch_task', fetchTaskNode)
    .addNode('orchestrator', orchestratorNode)
    .addNode('delegate_bridge', delegateBridgeNode)
    .addNode('worker', workerSubgraph)
    .addNode('human_review', humanInterruptNode)
    .addNode('clarify', clarifyInterruptNode)
    .addNode('push_task', pushTaskNode)
    .addEdge(START, 'fetch_task')
    .addEdge('fetch_task', 'orchestrator')
    .addConditionalEdges('orchestrator', routeTerminalIntent, {
      delegate: 'delegate_bridge',
      clarify: 'clarify',
      [END]: END,
    })
    .addEdge('delegate_bridge', 'worker')
    .addEdge('worker', 'human_review')
    .addConditionalEdges('human_review', routeVerdict, {
      greenlight: 'push_task',
      redlight: 'orchestrator',
    })
    .addEdge('push_task', END)
    .addEdge('clarify', 'orchestrator');
}
