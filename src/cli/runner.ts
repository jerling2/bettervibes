import * as readline from 'node:readline';
import { Command, isGraphInterrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { clearThread } from '../checkpointer';
import { buildBetterVibesGraph } from '../graph/graph';
import { PermissionGate } from '../graph/permissionGate';
import { CLAUDE_CODE_DEFAULT_TOOLS } from '../graph/worker';
import type { GraphStateType } from '../graph/state';
import { makeIncludeFiles } from '../tools/includeFiles';
import { makeFetchTask } from '../tools/fetchTask';
import { isOperatorOwned } from '../tools/touches';
import type { Paths } from '../paths';
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

export interface RunCliDeps {
  argv: string[];
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  buildGraph: () => ReturnType<typeof buildBetterVibesGraph>;
  checkpointer: BaseCheckpointSaver;
  paths: Paths;
}

type ParsedArgs =
  | { mode: 'run'; task_id: string; include: string[]; force: boolean }
  | { mode: 'resume' }
  | { mode: 'invalid'; message: string };

// ============================================================================
// Helpers
// ============================================================================

export const THREAD_ID = 'bettervibes-main';

export function parseArgs(argv: string[]): ParsedArgs {
  const usage =
    'Usage:\n  bettervibes init [--project-root <path>]\n  bettervibes inventory-sync [--project-root <path>]\n  bettervibes run <T-NN> [--include <path1> [<path2> ...]] [--force] [--project-root <path>]\n  bettervibes resume [--project-root <path>]';
  if (argv[0] === 'run' && argv.length >= 2 && argv[1].length > 0) {
    const task_id = argv[1];
    const rest = argv.slice(2);
    const include: string[] = [];
    let force = false;
    let i = 0;
    while (i < rest.length) {
      const tok = rest[i];
      if (tok === '--force') {
        force = true;
        i++;
        continue;
      }
      if (tok === '--include') {
        i++;
        let consumed = 0;
        while (
          i < rest.length &&
          rest[i] !== '--force' &&
          rest[i] !== '--include'
        ) {
          include.push(rest[i]);
          i++;
          consumed++;
        }
        if (consumed === 0) return { mode: 'invalid', message: usage };
        continue;
      }
      return { mode: 'invalid', message: usage };
    }
    return { mode: 'run', task_id, include, force };
  }
  if (argv.length === 1 && argv[0] === 'resume') {
    return { mode: 'resume' };
  }
  return { mode: 'invalid', message: usage };
}

function writeJsonLine(out: NodeJS.WritableStream, value: unknown): void {
  out.write(`${JSON.stringify(value)}\n`);
}

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

type JsonReadResult =
  | { kind: 'value'; value: unknown; raw: string }
  | { kind: 'empty' }
  | { kind: 'error'; error: Error; raw: string };

function createStdinReader(input: NodeJS.ReadableStream) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  type Mode = 'json' | 'dispatch';
  let mode: Mode = 'json';
  let jsonBuffer = '';
  let jsonResolver: ((r: JsonReadResult) => void) | null = null;
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

export async function runCli(deps: RunCliDeps): Promise<number> {
  const args = parseArgs(deps.argv);
  if (args.mode === 'invalid') {
    deps.stderr.write(`${args.message}\n`);
    return 2;
  }

  // Operator-owned guard: a task whose `## Touches` names only external
  // systems (DNS, dashboards) can't be satisfied by a worker. Refuse before
  // staging or invoking the graph, unless `--force`. A missing/unreadable
  // task is left to the graph to surface with its usual error.
  if (args.mode === 'run' && !args.force) {
    let body: string | null = null;
    try {
      const readTaskFile = makeFetchTask(deps.paths);
      ({ body } = await readTaskFile(args.task_id));
    } catch {
      body = null;
    }
    if (body !== null && isOperatorOwned(body)) {
      const message =
        `${args.task_id}: every \`## Touches\` entry names an external system ` +
        `and none name a repo file path — this task looks operator-owned. ` +
        `Refusing to delegate to a worker; re-run with --force to override.`;
      writeJsonLine(
        deps.stdout,
        CliOutput.parse({
          status: 'refused',
          reason: 'operator_owned',
          task_id: args.task_id,
          message,
        })
      );
      deps.stderr.write(`warning: ${message}\n`);
      return 2;
    }
  }

  const compiled = deps.buildGraph().compile({
    checkpointer: deps.checkpointer,
  });

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

    const pre = await compiled.getState(config);
    const prePending = (pre?.tasks ?? []).flatMap((t) => t.interrupts ?? []);
    if (prePending.length === 0) {
      reader.close();
      const event = CliOutput.parse({
        status: 'no_active_task',
        message:
          'no in-progress task to resume; run `bettervibes run <T-NN>` first',
      });
      writeJsonLine(deps.stdout, event);
      return 2;
    }

    const preValues = (pre?.values ?? {}) as Partial<GraphStateType>;
    if (typeof preValues.task_id === 'string')
      lastKnownContext.task_id = preValues.task_id;
    if (typeof preValues.iteration === 'number')
      lastKnownContext.iteration = preValues.iteration;
  }

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

  let input: Partial<GraphStateType> | Command<ResumeInputType>;
  if (args.mode === 'run') {
    try {
      const readIncludeFiles = makeIncludeFiles(deps.paths);
      const included_files = await readIncludeFiles(args.include);
      input = { task_id: args.task_id, included_files };
    } catch (e) {
      reader.close();
      deps.stderr.write(`${(e as Error).message}\n`);
      return 1;
    }
  } else {
    input = resumeCommand as Command<ResumeInputType>;
  }

  try {
    const stream = await compiled.stream(input as never, {
      ...config,
      streamMode: 'updates',
    });

    const drain = (async () => {
      for await (const update of stream) {
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

  if (values.human_verdict === 'greenlight') {
    try {
      await clearThread(deps.checkpointer, THREAD_ID);
    } catch (e) {
      deps.stderr.write(`${(e as Error).message}\n`);
      return 1;
    }
  }

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
