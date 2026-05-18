import {
  PREFLIGHT_IDEMPOTENCY_INSTRUCTION,
  buildWorkerPrompt,
} from './worker';

describe('buildWorkerPrompt', () => {
  const base = {
    instructions: 'Do the thing carefully.',
    taskContent: '# Task: add auth\n\nSteps here.',
    taskId: 'T-01',
    iteration: 1,
    reportPath:
      'bv_orchestration/logs/worker-reports/WR-01-add-auth-2026-05-07.md',
    metadata: null,
  };

  it('should include the orchestrator instructions', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain('Do the thing carefully.');
  });

  it('should include the task content', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain('# Task: add auth');
    expect(out).toContain('Steps here.');
  });

  it('should embed the supplied report path', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain(
      'bv_orchestration/logs/worker-reports/WR-01-add-auth-2026-05-07.md'
    );
  });

  it('should reference the WORKER_REPORT_TEMPLATE structure', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toContain('Executive Summary');
    expect(out).toContain('Implementation');
    expect(out).toContain('Files Touched');
    expect(out).toContain('Locked-in Decisions');
    expect(out).toContain("Worker's Narrative");
  });

  it('should end with the trailing write-report directive', () => {
    const out = buildWorkerPrompt(base);

    expect(out).toMatch(
      /write a factual report to[^\n]*WR-01-add-auth-2026-05-07\.md/
    );
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
