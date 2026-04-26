import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { clearThread } from './checkpointer';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Stuffs a synthetic checkpoint and one pending write into a `MemorySaver`
 * for the given thread. Bypasses the public `put`/`putWrites` API because
 * those require a fully-formed `Checkpoint`/`PendingWrite` shape that we
 * don't need for these tests — we only care that `clearThread` removes
 * exactly the threads it should.
 */
function seedThread(saver: MemorySaver, threadId: string): void {
  saver.storage[threadId] = {
    '': {
      'cp-1': [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
        undefined,
      ],
    },
  };
  const writeKey = JSON.stringify([threadId, '', 'cp-1']);
  saver.writes[writeKey] = {
    'task-a,0': ['task-a', 'channel-x', new Uint8Array([7, 8, 9])],
  };
}

// ============================================================================
// clearThread
// ============================================================================

describe('clearThread', () => {
  it('clears only the named thread on a MemorySaver', async () => {
    const saver = new MemorySaver();
    seedThread(saver, 'thread-a');
    seedThread(saver, 'thread-b');

    await clearThread(saver, 'thread-a');

    expect(saver.storage['thread-a']).toBeUndefined();
    expect(saver.storage['thread-b']).toBeDefined();
    const remainingKeys = Object.keys(saver.writes);
    const aLeft = remainingKeys.some(
      (k) => (JSON.parse(k) as unknown[])[0] === 'thread-a'
    );
    const bLeft = remainingKeys.some(
      (k) => (JSON.parse(k) as unknown[])[0] === 'thread-b'
    );
    expect(aLeft).toBe(false);
    expect(bLeft).toBe(true);
  });

  it('is a no-op when the thread has no entries', async () => {
    const saver = new MemorySaver();
    seedThread(saver, 'thread-b');

    await clearThread(saver, 'never-existed');

    expect(saver.storage['thread-b']).toBeDefined();
    expect(Object.keys(saver.writes).length).toBe(1);
  });

  it('throws fail-loud on an unsupported saver subclass', async () => {
    class FakeSaver {
      // Pretend to be a checkpointer the helper doesn't know about.
    }
    const saver = new FakeSaver() as unknown as BaseCheckpointSaver;
    await expect(clearThread(saver, 'x')).rejects.toThrow(
      /unsupported checkpointer type/
    );
  });
});
