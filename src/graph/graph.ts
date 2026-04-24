import { END, START, StateGraph } from '@langchain/langgraph';
import { AIMessage } from '@langchain/core/messages';
import { routeTerminalIntent, routeVerdict } from './edges';
import { fetchTaskNode, pushTaskNode } from './fetchPushNodes';
import { clarifyInterruptNode, humanInterruptNode } from './interrupts';
import { orchestratorNode } from './orchestrator';
import { GraphState, type GraphStateType } from './state';
import { workerSubgraph } from './worker';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Bridges the orchestrator's `terminal_intent.instructions` into the shape
 * the worker subgraph already consumes (the last `AIMessage` in
 * `state.messages`).
 *
 * @param state - Graph state. `terminal_intent` must be a delegate intent
 *   when this node runs — the `routeTerminalIntent` edge already branches on
 *   that.
 *
 * @remarks
 * Keeps the worker's `extractInstructions` contract unchanged: the worker
 * walks `state.messages` backwards for the most recent `AIMessage`. The
 * orchestrator writes its decision to `state.terminal_intent` (not to
 * `messages`), so this thin bridge translates between the two shapes. Any
 * future worker rewrite that reads from `terminal_intent` directly can
 * delete this node.
 */
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
 * Builds the parent BetterVibes graph. Returns an uncompiled `StateGraph` so
 * callers (CLI, tests) can pass their own checkpointer at compile time.
 *
 * @remarks
 * Topology per spec §4.2. Interrupt nodes (`human_review`, `clarify`) pause
 * via dynamic `interrupt()` calls rather than static `interruptBefore` — the
 * runner sees `GraphInterrupt` thrown and surfaces it to the caller. A
 * checkpointer is required for interrupt-resume behavior; `compile()`
 * without one still works for non-interrupt paths (useful in tests).
 */
export function buildBetterVibesGraph() {
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
