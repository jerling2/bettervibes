import { END } from '@langchain/langgraph';
import type { GraphStateType } from './state';

// ============================================================================
// Conditional Edges
// ============================================================================

/**
 * Routes the edge out of the orchestrator node based on `terminal_intent`.
 *
 * @param state - Graph state. `terminal_intent` must be set by the
 *   orchestrator node before this edge fires.
 *
 * @remarks
 * Returns edge keys (`'delegate'`, `'clarify'`) that the graph wiring maps to
 * the destination nodes, or `END` for the terminal `done` case. Throws fail-
 * loud if `terminal_intent` is unset — the orchestrator's contract guarantees
 * exactly one terminal tool per turn, so a null here means the orchestrator's
 * own fail-loud check should have already fired.
 */
export function routeTerminalIntent(state: GraphStateType): string {
  if (state.terminal_intent === null) {
    throw new Error('routeTerminalIntent: terminal_intent is null');
  }
  switch (state.terminal_intent.kind) {
    case 'delegate':
      return 'delegate';
    case 'clarify':
      return 'clarify';
    case 'done':
      return END;
  }
}

/**
 * Routes the edge out of the `HUMAN_INT` interrupt node based on the human's
 * verdict.
 *
 * @param state - Graph state. `human_verdict` must be set by the
 *   `humanInterruptNode` before this edge fires.
 *
 * @remarks
 * Returns edge keys (`'greenlight'`, `'redlight'`) that the graph wiring maps
 * to the destination nodes. Throws fail-loud if `human_verdict` is unset —
 * the interrupt node is contractually obligated to set it on resume.
 */
export function routeVerdict(state: GraphStateType): string {
  if (state.human_verdict === null) {
    throw new Error('routeVerdict: human_verdict is null');
  }
  return state.human_verdict;
}
