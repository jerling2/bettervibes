import { END } from '@langchain/langgraph';
import { routeTerminalIntent, routeVerdict } from './edges';
import type { GraphStateType } from './state';

const baseState: GraphStateType = {
  messages: [],
  baseline_messages: [],
  accumulated_notes: [],
  task_id: 'smoke',
  task_content: '# Task',
  task_metadata: null,
  iteration: null,
  report_path: null,
  terminal_intent: null,
  human_verdict: null,
};

describe('routeTerminalIntent', () => {
  it('should route delegate to the delegate_bridge edge key', () => {
    const result = routeTerminalIntent({
      ...baseState,
      terminal_intent: { kind: 'delegate', instructions: 'do the thing' },
    });

    expect(result).toBe('delegate');
  });

  it('should route clarify to the clarify edge key', () => {
    const result = routeTerminalIntent({
      ...baseState,
      terminal_intent: { kind: 'clarify', question: 'what scope?' },
    });

    expect(result).toBe('clarify');
  });

  it('should route done to END', () => {
    const result = routeTerminalIntent({
      ...baseState,
      terminal_intent: { kind: 'done' },
    });

    expect(result).toBe(END);
  });

  it('should throw when terminal_intent is null', () => {
    expect(() => routeTerminalIntent(baseState)).toThrow(/terminal_intent/i);
  });
});

describe('routeVerdict', () => {
  it('should route greenlight to the push_task edge key', () => {
    const result = routeVerdict({
      ...baseState,
      human_verdict: 'greenlight',
    });

    expect(result).toBe('greenlight');
  });

  it('should route redlight to the orchestrator edge key', () => {
    const result = routeVerdict({
      ...baseState,
      human_verdict: 'redlight',
    });

    expect(result).toBe('redlight');
  });

  it('should throw when human_verdict is null', () => {
    expect(() => routeVerdict(baseState)).toThrow(/human_verdict/i);
  });
});
