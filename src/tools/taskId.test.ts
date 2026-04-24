import { assertValidTaskId } from './taskId';

describe('assertValidTaskId', () => {
  it('should accept a simple alphanumeric-hyphen id', () => {
    expect(() => assertValidTaskId('add-auth-middleware')).not.toThrow();
  });

  it('should reject empty or whitespace-only ids', () => {
    expect(() => assertValidTaskId('')).toThrow(/invalid task_id/i);
    expect(() => assertValidTaskId('   ')).toThrow(/invalid task_id/i);
  });

  it('should reject ids containing "/"', () => {
    expect(() => assertValidTaskId('sub/dir')).toThrow(/invalid task_id/i);
  });

  it('should reject ids containing "\\"', () => {
    expect(() => assertValidTaskId('win\\path')).toThrow(/invalid task_id/i);
  });

  it('should reject ids containing ".."', () => {
    expect(() => assertValidTaskId('../evil')).toThrow(/invalid task_id/i);
  });
});
