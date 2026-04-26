const mockInterrupt = jest.fn();

jest.mock('@langchain/langgraph', () => {
  const actual = jest.requireActual('@langchain/langgraph');
  return { ...actual, interrupt: mockInterrupt };
});

import { HumanMessage } from '@langchain/core/messages';
import { clarifyInterruptNode, humanInterruptNode } from './interrupts';
import type { GraphStateType } from './state';

const baseState: GraphStateType = {
  messages: [],
  baseline_messages: [],
  accumulated_notes: [],
  task_id: 'smoke',
  task_content: '# Task',
  task_metadata: null,
  iteration: 1,
  report_path: '/abs/tasks/staged/smoke-01.md',
  terminal_intent: null,
  human_verdict: null,
  included_files: [],
};

describe('humanInterruptNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call interrupt with the human_review event payload', async () => {
    mockInterrupt.mockReturnValue({ decision: 'greenlight' });

    await humanInterruptNode(baseState);

    expect(mockInterrupt).toHaveBeenCalledTimes(1);
    const [payload] = mockInterrupt.mock.calls[0];
    expect(payload).toEqual({
      kind: 'human_review',
      task_id: 'smoke',
      iteration: 1,
      report_path: '/abs/tasks/staged/smoke-01.md',
    });
  });

  it('should set human_verdict=greenlight on greenlight', async () => {
    mockInterrupt.mockReturnValue({ decision: 'greenlight' });

    const result = await humanInterruptNode(baseState);

    expect(result.human_verdict).toBe('greenlight');
    expect(result.messages).toBeUndefined();
  });

  it('should set human_verdict=redlight and append feedback to messages on redlight', async () => {
    mockInterrupt.mockReturnValue({
      decision: 'redlight',
      feedback: 'the new schema field is not validated',
    });

    const result = await humanInterruptNode(baseState);

    expect(result.human_verdict).toBe('redlight');
    expect(result.messages).toHaveLength(1);
    const appended = result.messages?.[0] as HumanMessage;
    expect(appended).toBeInstanceOf(HumanMessage);
    expect(appended.content).toMatch(/redlight/i);
    expect(appended.content).toContain(
      'the new schema field is not validated'
    );
  });
});

describe('clarifyInterruptNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call interrupt with the clarify event payload built from terminal_intent', async () => {
    mockInterrupt.mockReturnValue({
      decision: 'clarify',
      answer: 'scope it to only the checkout flow',
    });

    await clarifyInterruptNode({
      ...baseState,
      terminal_intent: {
        kind: 'clarify',
        question: 'which routes should the middleware apply to?',
      },
    });

    expect(mockInterrupt).toHaveBeenCalledTimes(1);
    const [payload] = mockInterrupt.mock.calls[0];
    expect(payload).toEqual({
      kind: 'clarify',
      task_id: 'smoke',
      question: 'which routes should the middleware apply to?',
    });
  });

  it('should append the human answer to messages on resume', async () => {
    mockInterrupt.mockReturnValue({
      decision: 'clarify',
      answer: 'scope it to only the checkout flow',
    });

    const result = await clarifyInterruptNode({
      ...baseState,
      terminal_intent: { kind: 'clarify', question: 'which routes?' },
    });

    expect(result.messages).toHaveLength(1);
    const appended = result.messages?.[0] as HumanMessage;
    expect(appended).toBeInstanceOf(HumanMessage);
    expect(appended.content).toMatch(/clarification/i);
    expect(appended.content).toContain('scope it to only the checkout flow');
  });

  it('should throw when terminal_intent is not a clarify intent', async () => {
    await expect(
      clarifyInterruptNode({
        ...baseState,
        terminal_intent: { kind: 'done' },
      })
    ).rejects.toThrow(/clarify/i);
    expect(mockInterrupt).not.toHaveBeenCalled();
  });
});
