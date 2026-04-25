import { formatReportFilename } from '../tools/commitTask';
import {
  PREFLIGHT_IDEMPOTENCY_INSTRUCTION,
  buildWorkerPrompt,
} from './worker';

describe('buildWorkerPrompt', () => {
  const base = {
    instructions: 'Do the thing carefully.',
    taskContent: '# Task\n\nSteps here.',
    taskId: 'add-auth',
    iteration: 1,
    metadata: null,
  };

  it('should include the orchestrator instructions', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain('Do the thing carefully.');
  });

  it('should include the task content', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain('# Task');
    expect(out).toContain('Steps here.');
  });

  it('should embed the task_id in the report path', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain('tasks/staged/add-auth-01.md');
  });

  it('should zero-pad the iteration to two digits in the report path', () => {
    expect(buildWorkerPrompt({ ...base, iteration: 1 })).toContain('add-auth-01.md');
    expect(buildWorkerPrompt({ ...base, iteration: 9 })).toContain('add-auth-09.md');
    expect(buildWorkerPrompt({ ...base, iteration: 12 })).toContain('add-auth-12.md');
  });

  it('should end with the trailing write-report directive', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toMatch(
      /write a factual report to[^\n]*add-auth-01\.md[^\n]*describing what you did/i
    );
  });

  it('should use the same filename format as commitTask.verifyReportFile', () => {
    const out = buildWorkerPrompt(base);
    const expectedFilename = formatReportFilename(base.taskId, base.iteration);

    expect(out).toContain(expectedFilename);
  });

  it('should omit the pre-flight block when metadata is null', () => {
    const out = buildWorkerPrompt(base);

    expect(out).not.toContain(PREFLIGHT_IDEMPOTENCY_INSTRUCTION);
    expect(out).not.toContain('Pre-flight: idempotency check');
  });

  it('should omit the pre-flight block when idempotency_check is missing', () => {
    const out = buildWorkerPrompt({ ...base, metadata: {} });

    expect(out).not.toContain(PREFLIGHT_IDEMPOTENCY_INSTRUCTION);
  });

  it('should omit the pre-flight block when idempotency_check is false', () => {
    const out = buildWorkerPrompt({
      ...base,
      metadata: { idempotency_check: false },
    });

    expect(out).not.toContain(PREFLIGHT_IDEMPOTENCY_INSTRUCTION);
  });

  it('should prepend the pre-flight block when idempotency_check is true', () => {
    const out = buildWorkerPrompt({
      ...base,
      metadata: { idempotency_check: true },
    });

    expect(out).toContain(PREFLIGHT_IDEMPOTENCY_INSTRUCTION);
    expect(out.indexOf(PREFLIGHT_IDEMPOTENCY_INSTRUCTION)).toBe(0);
    expect(out.indexOf('Do the thing carefully.')).toBeGreaterThan(
      out.indexOf(PREFLIGHT_IDEMPOTENCY_INSTRUCTION)
    );
  });
});
