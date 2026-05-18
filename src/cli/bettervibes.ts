#!/usr/bin/env node
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { resolveProjectRoot } from '../projectRoot';
import { buildPaths } from '../paths';
import { buildBetterVibesGraph } from '../graph/graph';
import { runCli } from './runner';
import { runInit } from './init';
import { runInventorySync } from './inventorySync';
import { runUpdate } from './update';

// ============================================================================
// Helpers
// ============================================================================

interface ExtractedArgs {
  projectRootArg?: string;
  rest: string[];
}

/**
 * Strips `--project-root <path>` from argv and returns the override (if any)
 * and the remaining argv with that flag removed.
 */
function extractProjectRoot(argv: string[]): ExtractedArgs {
  const rest: string[] = [];
  let projectRootArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-root') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error('--project-root requires a path argument');
      }
      projectRootArg = value;
      i++;
      continue;
    }
    rest.push(argv[i]);
  }
  return { projectRootArg, rest };
}

// ============================================================================
// Entry
// ============================================================================

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let extracted: ExtractedArgs;
  try {
    extracted = extractProjectRoot(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const subcommand = extracted.rest[0];

  if (subcommand === 'init') {
    return runInit({
      projectRootArg: extracted.projectRootArg,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
    });
  }

  if (subcommand === 'inventory-sync') {
    return runInventorySync({
      projectRootArg: extracted.projectRootArg,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
    });
  }

  if (subcommand === 'update') {
    const dryRun = extracted.rest.includes('--dry-run');
    return runUpdate({
      projectRootArg: extracted.projectRootArg,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      dryRun,
    });
  }

  let root: string;
  try {
    root = resolveProjectRoot({ override: extracted.projectRootArg });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }
  const paths = buildPaths(root);

  // Cast through `unknown` past the nested `@langchain/langgraph-checkpoint`
  // version collision between `@langchain/langgraph@0.2.x` and
  // `@langchain/langgraph-checkpoint-sqlite@0.2.x`.
  const checkpointer = SqliteSaver.fromConnString(
    paths.checkpoint
  ) as unknown as BaseCheckpointSaver;

  return runCli({
    argv: extracted.rest,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    buildGraph: () => buildBetterVibesGraph(paths),
    checkpointer,
    paths,
  });
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  }
);
