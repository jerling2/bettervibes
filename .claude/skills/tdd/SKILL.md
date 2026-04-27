---
name: tdd
description: >-
  Test-driven development patterns using Jest and TypeScript. Covers
  red-green-refactor workflow, test structure, mocking, and assertions for
  this Node.js CLI codebase. TRIGGER when: writing new features, fixing
  bugs, refactoring existing code, creating new modules, or when the user
  mentions tests, testing, TDD, or Jest. DO NOT TRIGGER when: user
  explicitly says "skip tests" or "no tests", or when editing non-code
  files like docs or config.
---

# Test-Driven Development

Write tests first when practical, test after when not. Every feature, bug fix, and module should have corresponding tests. Tests are not optional.

## When to Activate

- Writing a new module, tool, graph node, or utility
- Fixing a bug (write a failing test that reproduces it first)
- Refactoring existing code (ensure tests exist before changing)
- User asks to add, update, or fix tests
- Creating a new file that contains logic
- Code review or validation of existing functionality

**Do not use** when the user explicitly says to skip tests, or when working on non-logic files (config, docs, static assets).

## Workflow

### Red-Green-Refactor

1. **Red** — Write a test that describes the expected behavior. Run it. It must fail.
2. **Green** — Write the minimum code to make the test pass. No more.
3. **Refactor** — Clean up the implementation without changing behavior. Tests must stay green.

### When Test-First Isn't Practical

Some situations make test-after more reasonable:

- Prototyping or exploring an unfamiliar API
- Spike work that will be rewritten

In these cases, write tests immediately after the implementation is stable. Do not merge or consider work complete without tests.

### Bug Fix Workflow

1. Write a failing test that reproduces the bug
2. Confirm the test fails for the right reason
3. Fix the bug
4. Confirm the test passes
5. Check that no other tests broke

## File Conventions

### Co-located Tests

Tests live next to the source file they test. No `__tests__` directories.

```
src/
├── checkpointer.ts
├── checkpointer.test.ts
├── tools/
│   ├── pushTask.ts
│   ├── pushTask.test.ts
│   ├── taskId.ts
│   └── taskId.test.ts
├── graph/
│   ├── orchestrator.ts
│   ├── orchestrator.test.ts
│   ├── worker.ts
│   └── worker.test.ts
```

### Naming

- Test files: `{source-filename}.test.ts`
- Test suites: `describe('moduleName', ...)` or `describe('functionName', ...)`
- Test cases: `it('should [expected behavior] when [condition]', ...)`

## Patterns

### Test Structure (Arrange-Act-Assert)

```typescript
// ✅ Clear arrange-act-assert
it('should return iteration number when filename matches the task id', () => {
  // Arrange
  const taskId = 'add-auth';

  // Act
  const result = matchReportFile(taskId, 'add-auth-02.md');

  // Assert
  expect(result).toEqual({ iteration: 2 });
});
```

### Throw / Reject Assertions

For input validators and other functions whose contract is "throws on bad input," assert on the thrown error directly.

```typescript
// ✅ assert on the throw, not on a return value
it('should reject ids containing ".."', () => {
  expect(() => assertValidTaskId('../evil')).toThrow(/invalid task_id/i);
});
```

### Mocking

```typescript
// ✅ Mock at module boundaries, not internals
jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  rename: jest.fn(),
}));

import { readdir } from 'fs/promises';

it('should return staged reports sorted ascending by iteration', async () => {
  (readdir as jest.Mock).mockResolvedValue([
    'add-auth-02.md',
    'add-auth-01.md',
  ]);

  const result = await collectStagedReports('add-auth');

  expect(result.map((r) => r.iteration)).toEqual([1, 2]);
});
```

## Anti-Patterns

- **Testing implementation details**: Don't assert on internal state, private methods, or how something works — test what it does.
- **Snapshot overuse**: Snapshots are brittle and hide intent. Use them sparingly. Prefer explicit assertions.
- **Giant test files**: If a test file exceeds 200 lines, the source module is likely doing too much. Split both.
- **Test interdependence**: Each test must run in isolation. No test should depend on another test running first.
- **Mocking everything**: Only mock external boundaries (filesystem, child processes, third-party SDKs). If you're mocking internal functions, the design may need rethinking.
- **No assertion**: Every test must have at least one `expect`. A test that only calls a function without asserting is not a test.
- **Vague test names**: `it('works')` or `it('should handle data')` tells you nothing when it fails. Be specific about the behavior and condition.

## Test Environment

All tests run under `jest-environment-node`, configured at the root `jest.config.json`. There is no jsdom environment in this project — there is no browser code to test.

## Quality Gate

Before considering any feature or fix complete:

- [ ] All new logic has corresponding tests
- [ ] Tests describe behavior, not implementation
- [ ] All tests pass (`npm test`)
- [ ] No skipped tests (`.skip`) left behind
- [ ] Test names clearly describe what and when
- [ ] Mocks are limited to external boundaries
