import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type {
  PermissionRequestEventType,
  PermissionResponseEventType,
} from '../cli/schemas';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PermissionGateConfig {
  /** Tool names approved at construction time — allowed without prompting. */
  allowlist: string[];
  /**
   * Emits a permission_request event to the transport (stdout in
   * production). Caller is responsible for serialization and framing.
   */
  emit: (event: PermissionRequestEventType) => void;
  /**
   * Returns the current task context (task_id, iteration) for inclusion in
   * each emitted event. Called per request so it always reflects live state.
   */
  context: () => {
    task_id: string | null;
    iteration: number | null;
  };
}

// ============================================================================
// PermissionGate
// ============================================================================

/**
 * Mediates tool-permission decisions between the Claude Agent SDK and the
 * human reviewer. Runs entirely in-process: when a tool is not pre-approved,
 * the gate emits a `permission_request` event and blocks the SDK's
 * `canUseTool` callback on a promise until the human's response lands via
 * `resolve()`.
 *
 * @remarks
 * See spec §3.2 and the approved plan. The gate is injected into the worker
 * subgraph via LangGraph's `RunnableConfig.configurable`. Session-level
 * approvals live only for the lifetime of the Node process; `bettervibes resume`
 * starts with an empty session allowlist.
 */
export class PermissionGate {
  private readonly allowlist: Set<string>;
  private readonly sessionAllowlist = new Set<string>();
  private readonly pending = new Map<
    string,
    (decision: PermissionResponseEventType['decision']) => void
  >();
  private readonly emit: PermissionGateConfig['emit'];
  private readonly context: PermissionGateConfig['context'];
  private counter = 0;

  constructor(config: PermissionGateConfig) {
    this.allowlist = new Set(config.allowlist);
    this.emit = config.emit;
    this.context = config.context;
  }

  /**
   * SDK callback. Fires for every tool invocation the SDK considers;
   * pre-approved tools short-circuit to allow, others prompt the human.
   *
   * @remarks
   * AbortSignal from the SDK is ignored in v1 — timeout / cancellation is
   * a future refinement. Input is returned unchanged on allow.
   */
  canUseTool: CanUseTool = async (toolName, input) => {
    if (this.allowlist.has(toolName) || this.sessionAllowlist.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    const decision = await this.requestDecision(toolName, input);
    return this.buildResult(toolName, input, decision);
  };

  /**
   * Resolves the promise for a pending permission request.
   *
   * @param response - The event read from the transport (stdin in
   *   production). Must carry a `request_id` emitted by this gate.
   *
   * @remarks
   * Throws if no pending promise matches the `request_id`. A mismatch
   * means the transport corrupted the exchange or the CLI sent a
   * response for a request that was never issued — fail loud rather
   * than swallow.
   */
  resolve(response: PermissionResponseEventType): void {
    const resolver = this.pending.get(response.request_id);
    if (!resolver) {
      throw new Error(
        `no pending permission request: ${response.request_id}`
      );
    }
    this.pending.delete(response.request_id);
    if (response.decision === 'allow_session') {
      // Session allowlist is keyed by tool name; we look it up via the
      // resolver's closure when the decision propagates.
    }
    resolver(response.decision);
  }

  private requestDecision(
    tool: string,
    args: Record<string, unknown>
  ): Promise<PermissionResponseEventType['decision']> {
    const request_id = `perm_${++this.counter}`;
    return new Promise((resolve) => {
      this.pending.set(request_id, (decision) => {
        if (decision === 'allow_session') {
          this.sessionAllowlist.add(tool);
        }
        resolve(decision);
      });
      const ctx = this.context();
      this.emit({
        kind: 'permission_request',
        request_id,
        tool,
        args,
        task_id: ctx.task_id,
        iteration: ctx.iteration,
      });
    });
  }

  private buildResult(
    tool: string,
    input: Record<string, unknown>,
    decision: PermissionResponseEventType['decision']
  ): PermissionResult {
    if (decision === 'deny') {
      return {
        behavior: 'deny',
        message: `Denied by human review: ${tool}`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  }
}
