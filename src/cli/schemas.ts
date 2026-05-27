import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

/**
 * Event emitted on the CLI's stdout when the worker asks the human for
 * permission to use a tool that is not in the pre-approved allowlist.
 *
 * @remarks
 * Private to this package (spec §4.4). Consumed by Claude Code's
 * bettervibes-orchestrator skill, which surfaces the request to the human in
 * natural language and writes back a `permission_response` on stdin.
 */
export const PermissionRequestEvent = z.object({
  kind: z.literal('permission_request'),
  request_id: z.string(),
  tool: z.string(),
  args: z.unknown(),
  task_id: z.string().nullable(),
  iteration: z.number().int().positive().nullable(),
});

export type PermissionRequestEventType = z.infer<typeof PermissionRequestEvent>;

/**
 * Event read from the CLI's stdin carrying the human's decision on a
 * pending permission request. `allow_session` approves the tool for the
 * remainder of this process; it does not survive `bettervibes resume`.
 */
export const PermissionResponseEvent = z.object({
  kind: z.literal('permission_response'),
  request_id: z.string(),
  decision: z.enum(['allow', 'deny', 'allow_session']),
});

export type PermissionResponseEventType = z.infer<typeof PermissionResponseEvent>;

/**
 * Resume payload read from stdin at the start of `bettervibes resume`. Maps the
 * human's decision on the most recent coarse interrupt (`human_review` or
 * `clarify`) to the `Command({ resume })` the graph consumes. Discriminated on
 * `decision`.
 *
 * @remarks
 * `greenlight` carries no body — the graph's `humanInterruptNode` treats
 * absence of feedback as the accept path. `redlight` and `clarify` require
 * non-empty free text; a zero-length answer would leave the orchestrator with
 * no signal to route on and is rejected at the CLI boundary.
 */
export const ResumeInput = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('greenlight') }),
  z.object({ decision: z.literal('redlight'), feedback: z.string().min(1) }),
  z.object({ decision: z.literal('clarify'), answer: z.string().min(1) }),
]);

export type ResumeInputType = z.infer<typeof ResumeInput>;

/**
 * Coarse CLI output event printed on stdout immediately before the process
 * exits. Exactly one is emitted per `bettervibes run` / `bettervibes resume` invocation.
 *
 * @remarks
 * Spec §4.4 describes this as `discriminatedUnion("status")`, but the
 * `interrupted` branch has two sub-shapes keyed by `interrupt`; zod v3's
 * discriminated union requires unique discriminator literals per branch, so
 * we use a plain union over three fully-specified object shapes. The wire
 * format is unchanged. `iterations` is `nonnegative` because the orchestrator
 * may call `mark_done` before any worker iteration has run.
 */
export const CliOutput = z.union([
  z.object({
    status: z.literal('interrupted'),
    interrupt: z.literal('human_review'),
    task_id: z.string(),
    iteration: z.number().int().positive(),
    report_path: z.string(),
  }),
  z.object({
    status: z.literal('interrupted'),
    interrupt: z.literal('clarify'),
    task_id: z.string(),
    question: z.string(),
  }),
  z.object({
    status: z.literal('done'),
    task_id: z.string(),
    iterations: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal('no_active_task'),
    message: z.string(),
  }),
  z.object({
    status: z.literal('refused'),
    reason: z.literal('operator_owned'),
    task_id: z.string(),
    message: z.string(),
  }),
]);

export type CliOutputType = z.infer<typeof CliOutput>;
