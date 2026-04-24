import { interrupt } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import type { GraphStateType } from './state';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Payload the graph emits to the CLI when `humanInterruptNode` pauses.
 * Shape mirrors spec §4.4's `CliOutput` entry for the `human_review` case.
 */
interface HumanReviewRequest {
  kind: 'human_review';
  task_id: string | null;
  iteration: number | null;
  report_path: string | null;
}

/** Resume payload for `humanInterruptNode`. Mirrors spec §4.4 `ResumeInput`. */
type HumanReviewResumeValue =
  | { decision: 'greenlight' }
  | { decision: 'redlight'; feedback: string };

/**
 * Payload the graph emits to the CLI when `clarifyInterruptNode` pauses.
 * Shape mirrors spec §4.4's `CliOutput` entry for the `clarify` case.
 */
interface ClarifyRequest {
  kind: 'clarify';
  task_id: string | null;
  question: string;
}

/** Resume payload for `clarifyInterruptNode`. Mirrors spec §4.4 `ResumeInput`. */
interface ClarifyResumeValue {
  decision: 'clarify';
  answer: string;
}

// ============================================================================
// Nodes
// ============================================================================

/**
 * Coarse `HUMAN_INT` interrupt. Pauses the graph until the human greenlights
 * or redlights the worker's report.
 *
 * @param state - Graph state. Reads `task_id`, `iteration`, and `report_path`
 *   to populate the interrupt payload.
 *
 * @remarks
 * Calling `interrupt()` throws `GraphInterrupt` when no resume value is
 * available, which the graph runner surfaces to the CLI as a pause. On resume
 * (`Command({ resume: { decision, feedback? } })`), `interrupt()` returns the
 * resume value and execution continues past it. Greenlight writes only
 * `human_verdict`; redlight also appends the feedback to `messages` as a
 * `HumanMessage` so the orchestrator's next-turn prompt picks it up
 * naturally.
 */
export async function humanInterruptNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const request: HumanReviewRequest = {
    kind: 'human_review',
    task_id: state.task_id,
    iteration: state.iteration,
    report_path: state.report_path,
  };
  const response = interrupt<HumanReviewRequest, HumanReviewResumeValue>(
    request
  );
  if (response.decision === 'greenlight') {
    return { human_verdict: 'greenlight' };
  }
  return {
    human_verdict: 'redlight',
    messages: [new HumanMessage(`REDLIGHT feedback: ${response.feedback}`)],
  };
}

/**
 * Coarse `CLARIFY` interrupt. Pauses the graph to let the human answer the
 * orchestrator's clarifying question.
 *
 * @param state - Graph state. Reads `terminal_intent.question` to populate
 *   the interrupt payload; throws if `terminal_intent` is not a clarify
 *   intent (routing bug).
 *
 * @remarks
 * Appends the human's answer to `messages` as a `HumanMessage`. The
 * orchestrator's next turn sees it in the rendered recent-activity block and
 * factors it into the next decision. `terminal_intent` is intentionally not
 * cleared here; the orchestrator's own turn overwrites it.
 */
export async function clarifyInterruptNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  if (state.terminal_intent?.kind !== 'clarify') {
    throw new Error(
      'clarifyInterruptNode: terminal_intent is not a clarify intent'
    );
  }
  const request: ClarifyRequest = {
    kind: 'clarify',
    task_id: state.task_id,
    question: state.terminal_intent.question,
  };
  const response = interrupt<ClarifyRequest, ClarifyResumeValue>(request);
  return {
    messages: [new HumanMessage(`CLARIFICATION answer: ${response.answer}`)],
  };
}
