import { MemorySaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Removes every checkpoint and write row belonging to `threadId` from the
 * given saver, leaving other threads untouched.
 *
 * @param saver - The compiled graph's checkpointer. `SqliteSaver` in
 *   production, `MemorySaver` in tests.
 * @param threadId - The fixed orchestrator thread identifier
 *   (`runner.THREAD_ID` in this codebase).
 *
 * @remarks
 * Used as the bookend on the greenlight → push-to-done success path so the
 * next `bettervibes run` starts on a clean thread. Both savers expose their
 * underlying storage as public fields, which is what we lean on here:
 *   - `SqliteSaver.db` (the `better-sqlite3` Database)
 *   - `MemorySaver.storage` and `.writes` (in-memory maps)
 *
 * No deletion API exists on `BaseCheckpointSaver` itself, so we type-narrow
 * by `instanceof` and fail loud on any other saver subclass — adding a new
 * checkpointer must teach this helper how to clear it.
 */
export async function clearThread(
  saver: BaseCheckpointSaver,
  threadId: string
): Promise<void> {
  if (saver instanceof SqliteSaver) {
    const db = saver.db;
    const tx = db.transaction((tid: string) => {
      db.prepare('DELETE FROM writes WHERE thread_id = ?').run(tid);
      db.prepare('DELETE FROM checkpoints WHERE thread_id = ?').run(tid);
    });
    tx(threadId);
    return;
  }
  if (saver instanceof MemorySaver) {
    delete saver.storage[threadId];
    for (const key of Object.keys(saver.writes)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(key);
      } catch {
        continue;
      }
      if (Array.isArray(parsed) && parsed[0] === threadId) {
        delete saver.writes[key];
      }
    }
    return;
  }
  throw new Error(
    `clearThread: unsupported checkpointer type ${saver.constructor.name}`
  );
}
