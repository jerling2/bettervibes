import * as readline from 'node:readline';
import { Command, isGraphInterrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { buildBetterVibesGraph } from '../graph/graph';
import { PermissionGate } from '../graph/permissionGate';
import { CLAUDE_CODE_DEFAULT_TOOLS } from '../graph/worker';
import type { GraphStateType } from '../graph/state';
import {
  CliOutput,
  PermissionRequestEvent,
  PermissionResponseEvent,
  ResumeInput,
  type CliOutputType,
  type ResumeInputType,
} from './schemas';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Dependency bundle injected into `runCli`. The production entry
 * (`cli/bettervibes.ts`) binds `process.{argv,stdin,stdout,stderr}` + a
 * `SqliteSaver`; unit tests bind `PassThrough` streams + a `MemorySaver`.
 */
export interface RunCliDeps {
  argv: string[];
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  buildGraph: () => ReturnType<typeof buildBetterVibesGraph>;
  checkpointer: BaseCheckpointSaver;
}

type ParsedArgs =
  | { mode: 'run'; task_id: string }
  | { mode: 'resume' }
  | { mode: 'invalid'; message: string };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fixed thread id for the orchestrator checkpointer. Spec §1.2 — a single
 * thread keeps baseline messages and accumulated notes (v2) tied to one
 * conversation across runs.
 */
export const THREAD_ID = 'bettervibes-main';

/**
 * Parses CLI arguments (argv slice after `node bettervibes.ts` is stripped) into a
 * discriminated mode descriptor.
 *
 * @param argv - Usually `process.argv.slice(2)`.
 *
 * @remarks
 * Rejects anything that isn't exactly `run <non-empty-id>` or `resume`. The
 * rejection message doubles as the usage string written to stderr.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 2 && argv[0] === 'run' && argv[1].length > 0) {
    return { mode: 'run', task_id: argv[1] };
  }
  if (argv.length === 1 && argv[0] === 'resume') {
    return { mode: 'resume' };
  }
  return {
    mode: 'invalid',
    message: 'Usage:\n  bettervibes run <task-id>\n  bettervibes resume < <resume-json>',
  };
}

/**
 * Writes a JSON-serialized record to an output stream as a single
 * newline-terminated line.
 */
function writeJsonLine(out: NodeJS.WritableStream, value: unknown): void {
  out.write(`${JSON.stringify(value)}\n`);
}

/**
 * Translates an interrupt payload (the value passed to `interrupt()` by
 * `humanInterruptNode` or `clarifyInterruptNode`) into the public `CliOutput`
 * event the caller sees on stdout.
 *
 * @remarks
 * Asserts the non-null invariants that hold at each interrupt site — paused
 * at HUMAN_INT means the worker just ran, so `iteration` and `report_path` are
 * set; paused at CLARIFY means the orchestrator's clarify intent is live, so
 * `question` is set. Violations are fail-loud bugs, not soft warnings.
 */
function mapInterruptToCliOutput(payload: unknown): CliOutputType {
  if (!payload || typeof payload !== 'object') {
    throw new Error(
      `unexpected interrupt payload: ${JSON.stringify(payload)}`
    );
  }
  const p = payload as Record<string, unknown>;
  if (p.kind === 'human_review') {
    if (typeof p.task_id !== 'string')
      throw new Error('human_review interrupt missing task_id');
    if (typeof p.iteration !== 'number' || p.iteration <= 0)
      throw new Error('human_review interrupt missing positive iteration');
    if (typeof p.report_path !== 'string')
      throw new Error('human_review interrupt missing report_path');
    return CliOutput.parse({
      status: 'interrupted',
      interrupt: 'human_review',
      task_id: p.task_id,
      iteration: p.iteration,
      report_path: p.report_path,
    });
  }
  if (p.kind === 'clarify') {
    if (typeof p.task_id !== 'string')
      throw new Error('clarify interrupt missing task_id');
    if (typeof p.question !== 'string')
      throw new Error('clarify interrupt missing question');
    return CliOutput.parse({
      status: 'interrupted',
      interrupt: 'clarify',
      task_id: p.task_id,
      question: p.question,
    });
  }
  throw new Error(`unknown interrupt kind: ${JSON.stringify(p.kind)}`);
}

/**
 * Result of `readJsonValue()` — `kind:'value'` carries the parsed JSON and
 * the raw text we parsed; `kind:'empty'` means EOF was reached with no
 * non-whitespace input; `kind:'error'` carries the final parse failure plus
 * the raw text so the caller can echo it.
 */
type JsonReadResult =
  | { kind: 'value'; value: unknown; raw: string }
  | { kind: 'empty' }
  | { kind: 'error'; error: Error; raw: string };

/**
 * Wraps a `readline.Interface` in a small state machine supporting two
 * sequential modes:
 *  1. *resume-JSON read* — `readJsonValue()` accumulates lines until either
 *     `JSON.parse` succeeds on the buffered text or stdin closes. Pretty-
 *     printed multi-line JSON is supported; the buffer terminates at the
 *     first complete value.
 *  2. *dispatch* — after `startDispatch(handler)` is called, every subsequent
 *     line is handed to `handler` until `close()`.
 *
 * @remarks
 * Keeps all stdin ingestion through one `line` event listener so readline's
 * internal buffering stays consistent. Lines that arrive in dispatch mode
 * before `startDispatch` is called are queued and flushed when it is set, so
 * a fast-arriving permission_response cannot be dropped between modes.
 */
function createStdinReader(input: NodeJS.ReadableStream) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  type Mode = 'json' | 'dispatch';
  let mode: Mode = 'json';
  let jsonBuffer = '';
  let jsonResolver: ((r: JsonReadResult) => void) | null = null;
  // Holds a settled JSON result that arrived before `readJsonValue()` was
  // called (e.g. tests that pre-write to stdin) so the next call still sees it.
  let cachedResult: JsonReadResult | null = null;
  let dispatch: ((line: string) => void) | null = null;
  const dispatchQueue: string[] = [];
  let closed = false;

  function settleJson(result: JsonReadResult) {
    const r = jsonResolver;
    jsonResolver = null;
    jsonBuffer = '';
    mode = 'dispatch';
    if (r) {
      r(result);
    } else {
      cachedResult = result;
    }
  }

  function tryParseBuffered(): boolean {
    const trimmed = jsonBuffer.trim();
    if (!trimmed) return false;
    try {
      const value = JSON.parse(trimmed);
      settleJson({ kind: 'value', value, raw: trimmed });
      return true;
    } catch {
      return false;
    }
  }

  function drainOnClose(): JsonReadResult {
    const trimmed = jsonBuffer.trim();
    if (!trimmed) return { kind: 'empty' };
    try {
      const value = JSON.parse(trimmed);
      return { kind: 'value', value, raw: trimmed };
    } catch (e) {
      return { kind: 'error', error: e as Error, raw: trimmed };
    }
  }

  rl.on('line', (line) => {
    if (mode === 'json') {
      jsonBuffer += jsonBuffer ? `\n${line}` : line;
      tryParseBuffered();
      return;
    }
    if (dispatch) {
      dispatch(line);
    } else {
      dispatchQueue.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (mode === 'json') {
      // Settle whatever's buffered. If no consumer is waiting yet, the result
      // is cached and replayed by the next `readJsonValue()` call.
      settleJson(drainOnClose());
    }
  });

  return {
    readJsonValue(): Promise<JsonReadResult> {
      if (cachedResult !== null) {
        const r = cachedResult;
        cachedResult = null;
        return Promise.resolve(r);
      }
      return new Promise<JsonReadResult>((resolve) => {
        jsonResolver = resolve;
        if (closed) settleJson(drainOnClose());
      });
    },
    startDispatch(handler: (line: string) => void) {
      dispatch = handler;
      // `run` mode never calls `readJsonValue`, so mode is still `'json'`
      // here and incoming `permission_response` lines would otherwise be
      // accumulated as JSON. Force the transition; flush any text the JSON
      // buffer happened to capture as dispatch lines so nothing is dropped.
      if (mode === 'json') {
        mode = 'dispatch';
        if (jsonBuffer) {
          const lines = jsonBuffer.split('\n');
          jsonBuffer = '';
          for (const l of lines) handler(l);
        }
      }
      while (dispatchQueue.length > 0) {
        const next = dispatchQueue.shift();
        if (next !== undefined) handler(next);
      }
    },
    close() {
      closed = true;
      rl.close();
    },
  };
}

// ============================================================================
// Runner
// ============================================================================

/**
 * Pure core of the `bettervibes` CLI. Returns the process's eventual exit code
 * (0 = success or coarse interrupt, 1 = runtime error, 2 = argv or stdin
 * protocol error).
 *
 * @param deps - Injected I/O streams, graph builder, and checkpointer.
 *
 * @remarks
 * Compiles the graph with the injected checkpointer, bridges the worker's
 * `PermissionGate` over newline-delimited JSON on `deps.stdin` / `deps.stdout`,
 * drains the graph via `stream(streamMode: 'updates')` so it can keep the
 * gate's task context fresh from each node's update, then asks the
 * checkpointer whether the graph paused (coarse interrupt) or terminated
 * (END) to pick the right coarse event to emit.
 */
export async function runCli(deps: RunCliDeps): Promise<number> {
  const args = parseArgs(deps.argv);
  if (args.mode === 'invalid') {
    deps.stderr.write(`${args.message}\n`);
    return 2;
  }

  const compiled = deps.buildGraph().compile({
    checkpointer: deps.checkpointer,
  });

  // Context the PermissionGate closes over. Iteration is populated by the
  // stream-update observer below; task_id is seeded from argv (run) or from
  // the checkpointer's pre-invoke snapshot (resume).
  const lastKnownContext: {
    task_id: string | null;
    iteration: number | null;
  } = {
    task_id: args.mode === 'run' ? args.task_id : null,
    iteration: null,
  };

  const gate = new PermissionGate({
    allowlist: CLAUDE_CODE_DEFAULT_TOOLS,
    emit: (event) => {
      const validated = PermissionRequestEvent.parse(event);
      writeJsonLine(deps.stdout, validated);
    },
    context: () => ({ ...lastKnownContext }),
  });

  const config: RunnableConfig = {
    configurable: { thread_id: THREAD_ID, permissionGate: gate },
  };

  const reader = createStdinReader(deps.stdin);

  let resumeCommand: Command<ResumeInputType> | null = null;
  if (args.mode === 'resume') {
    const read = await reader.readJsonValue();
    if (read.kind === 'empty') {
      reader.close();
      deps.stderr.write(
        'bettervibes resume: expected ResumeInput JSON on stdin\n'
      );
      return 2;
    }
    if (read.kind === 'error') {
      reader.close();
      deps.stderr.write(
        `bettervibes resume: invalid ResumeInput JSON: ${read.error.message}\n`
      );
      return 2;
    }
    try {
      const resume = ResumeInput.parse(read.value);
      resumeCommand = new Command({ resume });
    } catch (e) {
      reader.close();
      deps.stderr.write(
        `bettervibes resume: invalid ResumeInput JSON: ${(e as Error).message}\n`
      );
      return 2;
    }

    // Refuse to invoke the graph when there's nothing to resume — without
    // this, `stream(Command({resume}))` against an empty/terminated thread
    // returns `done` with empty task_id/0 iterations, which is
    // indistinguishable from a successful run that completed normally.
    const pre = await compiled.getState(config);
    const prePending = (pre?.tasks ?? []).flatMap((t) => t.interrupts ?? []);
    if (prePending.length === 0) {
      reader.close();
      const event = CliOutput.parse({
        status: 'no_active_task',
        message:
          'no in-progress task to resume; run `bettervibes run <task-id>` first',
      });
      writeJsonLine(deps.stdout, event);
      return 2;
    }

    // Seed lastKnownContext from the pre-resume checkpoint so the gate has
    // accurate task_id/iteration if a permission prompt fires immediately.
    const preValues = (pre?.values ?? {}) as Partial<GraphStateType>;
    if (typeof preValues.task_id === 'string')
      lastKnownContext.task_id = preValues.task_id;
    if (typeof preValues.iteration === 'number')
      lastKnownContext.iteration = preValues.iteration;
  }

  // Bail channel — dispatch loop rejects this on malformed stdin; races the
  // graph stream. Invoke-first-wins with a thrown protocol error.
  let bailReject: (e: Error) => void = () => {};
  const bailPromise = new Promise<never>((_, reject) => {
    bailReject = reject;
  });

  reader.startDispatch((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      bailReject(new Error(`invalid stdin JSON: ${trimmed}`));
      return;
    }
    const event = PermissionResponseEvent.safeParse(parsed);
    if (!event.success) {
      bailReject(
        new Error(`invalid permission_response on stdin: ${trimmed}`)
      );
      return;
    }
    try {
      gate.resolve(event.data);
    } catch (e) {
      bailReject(new Error((e as Error).message));
    }
  });

  const input =
    args.mode === 'run'
      ? ({ task_id: args.task_id } as Partial<GraphStateType>)
      : (resumeCommand as Command<ResumeInputType>);

  try {
    const stream = await compiled.stream(input as never, {
      ...config,
      streamMode: 'updates',
    });

    const drain = (async () => {
      for await (const update of stream) {
        // Each update is `{ [nodeName]: partialState }`. We look across all
        // partial states for iteration / task_id writes and mirror them into
        // lastKnownContext so the gate emits accurate events.
        if (!update || typeof update !== 'object') continue;
        for (const value of Object.values(update)) {
          if (!value || typeof value !== 'object') continue;
          const s = value as Partial<GraphStateType>;
          if (typeof s.task_id === 'string') lastKnownContext.task_id = s.task_id;
          if (typeof s.iteration === 'number')
            lastKnownContext.iteration = s.iteration;
        }
      }
    })();

    await Promise.race([drain, bailPromise]);
  } catch (err) {
    reader.close();
    if (isGraphInterrupt(err)) {
      // Top-level interrupts are normally suppressed by langgraph's runner
      // and surface via getState; if one propagates, treat it the same.
      return emitFromCheckpoint(compiled, config, deps, args);
    }
    deps.stderr.write(
      `${(err as Error).stack ?? (err as Error).message}\n`
    );
    return 1;
  }

  reader.close();
  return emitFromCheckpoint(compiled, config, deps, args);
}

/**
 * Reads the post-run checkpoint and emits the matching `CliOutput` event.
 * Called after the graph stream drains — either because it hit END or because
 * it paused at an interrupt (langgraph suppresses `GraphInterrupt` at the top
 * level; pending interrupts live on the snapshot's tasks).
 */
async function emitFromCheckpoint(
  compiled: ReturnType<ReturnType<typeof buildBetterVibesGraph>['compile']>,
  config: RunnableConfig,
  deps: RunCliDeps,
  args: Exclude<ParsedArgs, { mode: 'invalid' }>
): Promise<number> {
  const snapshot = await compiled.getState(config);
  const pending = (snapshot?.tasks ?? []).flatMap((t) => t.interrupts ?? []);

  if (pending.length > 0) {
    try {
      const event = mapInterruptToCliOutput(pending[0].value);
      writeJsonLine(deps.stdout, event);
      return 0;
    } catch (mapErr) {
      deps.stderr.write(`${(mapErr as Error).message}\n`);
      return 1;
    }
  }

  const values = (snapshot?.values ?? {}) as Partial<GraphStateType>;
  const taskId =
    values.task_id ?? (args.mode === 'run' ? args.task_id : '');
  const iterations = values.iteration ?? 0;
  try {
    const done = CliOutput.parse({
      status: 'done',
      task_id: taskId,
      iterations,
    });
    writeJsonLine(deps.stdout, done);
    return 0;
  } catch (e) {
    deps.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}
