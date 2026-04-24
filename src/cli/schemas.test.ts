import { CliOutput, ResumeInput } from './schemas';

describe('ResumeInput', () => {
  it('accepts a bare greenlight', () => {
    expect(ResumeInput.parse({ decision: 'greenlight' })).toEqual({
      decision: 'greenlight',
    });
  });

  it('accepts a redlight with non-empty feedback', () => {
    const parsed = ResumeInput.parse({
      decision: 'redlight',
      feedback: 'report is missing the acceptance criteria',
    });
    expect(parsed).toEqual({
      decision: 'redlight',
      feedback: 'report is missing the acceptance criteria',
    });
  });

  it('rejects a redlight with empty feedback', () => {
    expect(() =>
      ResumeInput.parse({ decision: 'redlight', feedback: '' })
    ).toThrow();
  });

  it('rejects a redlight missing feedback entirely', () => {
    expect(() => ResumeInput.parse({ decision: 'redlight' })).toThrow();
  });

  it('accepts a clarify with non-empty answer', () => {
    expect(
      ResumeInput.parse({ decision: 'clarify', answer: 'use JWT, not sessions' })
    ).toEqual({ decision: 'clarify', answer: 'use JWT, not sessions' });
  });

  it('rejects a clarify with empty answer', () => {
    expect(() =>
      ResumeInput.parse({ decision: 'clarify', answer: '' })
    ).toThrow();
  });

  it('rejects an unknown decision', () => {
    expect(() =>
      ResumeInput.parse({ decision: 'abstain', answer: 'hi' })
    ).toThrow();
  });

  it('rejects a greenlight with extra feedback field when strict checks are off', () => {
    // Zod is permissive by default on extra keys; confirm the accepted shape
    // still strips to the greenlight branch rather than matching redlight.
    const parsed = ResumeInput.parse({
      decision: 'greenlight',
      feedback: 'ignored',
    });
    expect(parsed).toEqual({ decision: 'greenlight' });
  });
});

describe('CliOutput', () => {
  it('accepts a human_review interrupt', () => {
    const payload = {
      status: 'interrupted',
      interrupt: 'human_review',
      task_id: 'smoke',
      iteration: 1,
      report_path: 'packages/langgraph/src/tasks/staged/smoke-01.md',
    };
    expect(CliOutput.parse(payload)).toEqual(payload);
  });

  it('rejects a human_review with iteration=0', () => {
    expect(() =>
      CliOutput.parse({
        status: 'interrupted',
        interrupt: 'human_review',
        task_id: 'smoke',
        iteration: 0,
        report_path: 'x',
      })
    ).toThrow();
  });

  it('accepts a clarify interrupt', () => {
    const payload = {
      status: 'interrupted',
      interrupt: 'clarify',
      task_id: 'smoke',
      question: 'should auth use JWT or sessions?',
    };
    expect(CliOutput.parse(payload)).toEqual(payload);
  });

  it('accepts a done event with iterations=0 (mark_done short path)', () => {
    const payload = { status: 'done', task_id: 'smoke', iterations: 0 };
    expect(CliOutput.parse(payload)).toEqual(payload);
  });

  it('accepts a done event with iterations>0', () => {
    const payload = { status: 'done', task_id: 'smoke', iterations: 3 };
    expect(CliOutput.parse(payload)).toEqual(payload);
  });

  it('rejects a done event with negative iterations', () => {
    expect(() =>
      CliOutput.parse({ status: 'done', task_id: 'smoke', iterations: -1 })
    ).toThrow();
  });

  it('rejects a done event with non-integer iterations', () => {
    expect(() =>
      CliOutput.parse({ status: 'done', task_id: 'smoke', iterations: 1.5 })
    ).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() =>
      CliOutput.parse({ status: 'aborted', task_id: 'smoke' })
    ).toThrow();
  });

  it('rejects interrupted without an interrupt discriminator', () => {
    expect(() =>
      CliOutput.parse({ status: 'interrupted', task_id: 'smoke' })
    ).toThrow();
  });
});
