#!/usr/bin/env node
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { buildBetterVibesGraph } from '../graph/graph';
import { runCli } from './runner';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Absolute path to the SQLite checkpoint file, rooted at the consumer
 * project's cwd. Gitignored by convention; delete `.bettervibes/` to start
 * fresh. The `SqliteSaver` requires the containing directory to exist — we
 * create it on boot along with the three task directories.
 */
const CHECKPOINT_PATH = path.resolve(
  process.cwd(),
  '.bettervibes/checkpoint.sqlite'
);

function ensureBetterVibesDirs(): void {
  const cwd = process.cwd();
  mkdirSync(path.resolve(cwd, 'tasks/ingest'), { recursive: true });
  mkdirSync(path.resolve(cwd, 'tasks/staged'), { recursive: true });
  mkdirSync(path.resolve(cwd, 'tasks/done'), { recursive: true });
  mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
}

// ============================================================================
// Entry
// ============================================================================

async function main(): Promise<number> {
  ensureBetterVibesDirs();
  // Cast through `unknown` past the nested `@langchain/langgraph-checkpoint`
  // version collision between `@langchain/langgraph@0.2.x` (peers 0.0.18) and
  // `@langchain/langgraph-checkpoint-sqlite@0.2.x` (peers 0.1.x). Same family
  // of workaround as the `sdkTool` zod v3/v4 cast in orchestrator.ts — runtime
  // behavior is correct; only the structural-type check is fooled.
  const checkpointer = SqliteSaver.fromConnString(
    CHECKPOINT_PATH
  ) as unknown as BaseCheckpointSaver;
  return runCli({
    argv: process.argv.slice(2),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    buildGraph: buildBetterVibesGraph,
    checkpointer,
  });
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  }
);
