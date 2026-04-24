import { formatReportFilename } from '../tools/commitTask';
import { buildWorkerPrompt } from './worker';

describe('buildWorkerPrompt', () => {
  const base = {
    instructions: 'Do the thing carefully.',
    taskContent: '# Task\n\nSteps here.',
    taskId: 'add-auth',
    iteration: 1,
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

    expect(out).toContain('packages/langgraph/src/tasks/staged/add-auth-01.md');
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
});
