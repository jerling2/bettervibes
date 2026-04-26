import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { TaskMetadata } from '../tools/fetchTask';
import type { IncludedFile } from '../tools/includeFiles';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Discriminated union of terminal decisions the orchestrator can return from
 * a single turn. Routes the conditional edge after `ORCHESTRATOR`.
 */
export type TerminalIntent =
  | { kind: 'delegate'; instructions: string }
  | { kind: 'clarify'; question: string }
  | { kind: 'done' };

// ============================================================================
// Schemas
// ============================================================================

/**
 * Graph state definition — the single source of truth for every field the
 * orchestrator, worker subgraph, and CLI read or write.
 *
 * @remarks
 * Fields match spec §4.3. The `messages` reducer is currently append-only
 * (`messagesStateReducer`). Spec §6.2 requires replace semantics too for the
 * greenlight compaction reset; swap in a custom append-or-replace reducer
 * when the v2 `resetMessages` tool is built. `baseline_messages` and
 * `accumulated_notes` are v2-only fields carried here for forward
 * compatibility; they are not exercised in v1 (§8.2).
 */
export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  baseline_messages: Annotation<BaseMessage[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  accumulated_notes: Annotation<string[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  task_id: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  task_content: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  task_metadata: Annotation<TaskMetadata | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  iteration: Annotation<number | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  report_path: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  terminal_intent: Annotation<TerminalIntent | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  human_verdict: Annotation<'greenlight' | 'redlight' | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  included_files: Annotation<IncludedFile[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
});

export type GraphStateType = typeof GraphState.State;
