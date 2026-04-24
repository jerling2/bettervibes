import type { PermissionRequestEventType } from '../cli/schemas';
import { PermissionGate } from './permissionGate';

function makeGate(
  allowlist: string[] = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']
) {
  const events: PermissionRequestEventType[] = [];
  const gate = new PermissionGate({
    allowlist,
    emit: (event) => events.push(event),
    context: () => ({ task_id: 'demo', iteration: 1 }),
  });
  return { gate, events };
}

const CAN_USE_TOOL_OPTS = {
  signal: new AbortController().signal,
  toolUseID: 'tu_1',
};

describe('PermissionGate.canUseTool', () => {
  it('should allow a tool in the base allowlist without emitting', async () => {
    const { gate, events } = makeGate();

    const result = await gate.canUseTool(
      'Read',
      { path: 'foo.ts' },
      CAN_USE_TOOL_OPTS
    );

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { path: 'foo.ts' },
    });
    expect(events).toHaveLength(0);
  });

  it('should allow a tool previously approved via allow_session without emitting again', async () => {
    const { gate, events } = makeGate();

    const firstCall = gate.canUseTool('WebFetch', { url: 'x' }, CAN_USE_TOOL_OPTS);
    expect(events).toHaveLength(1);
    gate.resolve({
      kind: 'permission_response',
      request_id: events[0].request_id,
      decision: 'allow_session',
    });
    await firstCall;

    const secondCall = await gate.canUseTool(
      'WebFetch',
      { url: 'y' },
      CAN_USE_TOOL_OPTS
    );

    expect(secondCall).toEqual({ behavior: 'allow', updatedInput: { url: 'y' } });
    expect(events).toHaveLength(1); // no new event
  });

  it('should emit a permission_request with a unique request_id for an unknown tool', async () => {
    const { gate, events } = makeGate();

    const pending = gate.canUseTool('WebFetch', { url: 'x' }, CAN_USE_TOOL_OPTS);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'permission_request',
      tool: 'WebFetch',
      args: { url: 'x' },
      task_id: 'demo',
      iteration: 1,
    });
    expect(typeof events[0].request_id).toBe('string');
    expect(events[0].request_id.length).toBeGreaterThan(0);

    // resolve so the promise settles and we don't leak
    gate.resolve({
      kind: 'permission_response',
      request_id: events[0].request_id,
      decision: 'deny',
    });
    await pending;
  });

  it('should resolve to allow when the human responds allow', async () => {
    const { gate, events } = makeGate();

    const pending = gate.canUseTool('WebFetch', { url: 'x' }, CAN_USE_TOOL_OPTS);
    gate.resolve({
      kind: 'permission_response',
      request_id: events[0].request_id,
      decision: 'allow',
    });

    expect(await pending).toEqual({
      behavior: 'allow',
      updatedInput: { url: 'x' },
    });
  });

  it('should resolve to deny when the human responds deny', async () => {
    const { gate, events } = makeGate();

    const pending = gate.canUseTool('WebFetch', { url: 'x' }, CAN_USE_TOOL_OPTS);
    gate.resolve({
      kind: 'permission_response',
      request_id: events[0].request_id,
      decision: 'deny',
    });

    const result = await pending;
    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/WebFetch/);
    }
  });

  it('should grant subsequent calls for the same tool after allow_session', async () => {
    const { gate, events } = makeGate();

    const first = gate.canUseTool('WebFetch', { url: 'x' }, CAN_USE_TOOL_OPTS);
    gate.resolve({
      kind: 'permission_response',
      request_id: events[0].request_id,
      decision: 'allow_session',
    });
    const firstResult = await first;
    expect(firstResult.behavior).toBe('allow');

    const second = await gate.canUseTool(
      'WebFetch',
      { url: 'y' },
      CAN_USE_TOOL_OPTS
    );
    expect(second.behavior).toBe('allow');
    expect(events).toHaveLength(1);
  });
});

describe('PermissionGate.resolve', () => {
  it('should throw when resolve is called with an unknown request_id', () => {
    const { gate } = makeGate();

    expect(() =>
      gate.resolve({
        kind: 'permission_response',
        request_id: 'perm_does_not_exist',
        decision: 'allow',
      })
    ).toThrow(/no pending permission request/i);
  });

  it('should assign distinct request_ids to concurrent pending requests and resolve them independently', async () => {
    const { gate, events } = makeGate();

    const a = gate.canUseTool('WebFetch', { url: 'a' }, CAN_USE_TOOL_OPTS);
    const b = gate.canUseTool('WebSearch', { q: 'b' }, CAN_USE_TOOL_OPTS);

    expect(events).toHaveLength(2);
    expect(events[0].request_id).not.toBe(events[1].request_id);

    // Resolve in reverse order.
    gate.resolve({
      kind: 'permission_response',
      request_id: events[1].request_id,
      decision: 'allow',
    });
    gate.resolve({
      kind: 'permission_response',
      request_id: events[0].request_id,
      decision: 'deny',
    });

    const resultA = await a;
    const resultB = await b;
    expect(resultA.behavior).toBe('deny');
    expect(resultB.behavior).toBe('allow');
  });
});
