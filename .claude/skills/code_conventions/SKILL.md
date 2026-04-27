---
name: code_conventions
description: >-
  TypeScript code conventions for this project: file structure, section
  headers, JSDoc patterns, and line-length rules. TRIGGER when: writing or
  reviewing any TypeScript file in this codebase — Zod schemas, helper
  functions, graph nodes, tools, or CLI commands. DO NOT TRIGGER when: the
  user explicitly says to ignore conventions or is writing a throwaway
  script.
---

# Code Conventions

Conventions for TypeScript files in this project. Apply these any time you
write or review TypeScript — schemas, helpers, graph nodes, tools, CLI
commands, or test files.

---

## When to Activate

- Writing a new TypeScript file
- Adding a schema, helper, or exported function to an existing file
- Reviewing code for style or documentation quality
- Refactoring code structure or documentation

**Do not use** when the user explicitly says to skip conventions or is writing a
one-off throwaway script.

---

## File Structure

Sections appear in this fixed order. Do not mix them. Omit any section that
isn't needed.

```
1. Types & Interfaces
2. Schemas
3. Helpers
4. Main Exports
```

**Derived types** (`z.infer`) are co-located with their schema, not in the
Types section — they cannot reference a `const` that hasn't been declared yet.

---

## Section Headers

Use `// ===...===` padded to 80 characters. Label goes on its own line,
flush-left, between the two banner lines.

```typescript
// ============================================================================
// Helpers
// ============================================================================
```

---

## Documentation Principle

Documentation has a maintenance cost. Document the non-obvious; let the code
speak for the rest.

After writing documentation, ask: "Does this explain all non-obvious design
choices?" If a design choice exists but its intent is unclear from the code,
document that the intent is unknown. That counts as explaining the why.

---

## Documentation Rules

### Line Length

- Documentation: always ≤ 100 characters per line. No exceptions.
- Code: aim for ≤ 100 characters. May exceed when splitting would look forced.

### Language

- Short, plain sentences. No em-dashes, no semicolons, no complex clauses.
- No uncommon acronyms. Spell out anything a new reader might not know.

---

## Documentation Patterns by Section

### Types & Interfaces

No JSDoc. TypeScript is self-documenting here.

```typescript
// ✅
interface TaskReport {
  taskId: string;
  iteration: number;
  path: string;
}

// ❌ — don't add JSDoc to plain interfaces
/** Represents a task report on disk. */
interface TaskReport { ... }
```

---

### Schemas

JSDoc one-liner describing what the schema validates. Add `@remarks` only for
non-obvious decisions (e.g., why a field is nullable, or a constraint that
isn't obvious from the type).

```typescript
/**
 * Event read from the CLI's stdin carrying the human's decision on a pending
 * permission request.
 *
 * @remarks
 * `allow_session` approves the tool for the remainder of this process; it
 * does not survive `bettervibes resume`.
 */
export const PermissionResponseEvent = z.object({
  kind: z.literal('permission_response'),
  request_id: z.string(),
  decision: z.enum(['allow', 'deny', 'allow_session']),
});

export type PermissionResponseEventType = z.infer<typeof PermissionResponseEvent>;
```

---

### Helpers

One-liner describing what the function returns or does. Then:

- `@param` for each argument — include the design rationale (the "why"), not
  just the type. Wrap continuation lines at 100 chars with two-space indent.
- `@remarks` for body-level decisions: error behavior, edge cases, or
  non-obvious invariants the caller must know about.

```typescript
/**
 * Returns the iteration number if `name` is a report for `taskId`.
 *
 * @param taskId - The canonical task identifier. Caller has validated it.
 * @param name - The candidate filename (basename, not a full path).
 *
 * @remarks
 * A report matches iff stripping the trailing `-\d+` and `.md` suffix yields
 * exactly `taskId`. This excludes prefix collisions like `task-extended-01.md`
 * when `taskId` is `task`, per the rule in spec §5.2.
 */
function matchReportFile(
  taskId: string,
  name: string
): { iteration: number } | null { ... }
```

---

### Main Exports

Exported functions and classes follow the same pattern as helpers: one-liner
JSDoc describing what the export does, plus `@param` and `@remarks` only when
the design is non-obvious. `@example` blocks are encouraged for entry points
whose call shape is not obvious from the signature alone.

---

## File Naming

TypeScript files use camelCase: `pushTask.ts`, `matchReportFile.ts`,
`orchestrator.ts`. Test files mirror the source: `pushTask.test.ts`.

---

## Export Conventions

Use inline named exports. Do not use default exports or `module.exports`.

```typescript
// ✅
export function pushTask() { ... }
export const PermissionResponseEvent = z.object({ ... });

// ❌
export default function pushTask() { ... }
module.exports = { pushTask };
```

---

## Anti-Patterns

- **JSDoc on interfaces** — TypeScript types are self-documenting. Skip it.
- **`@param` without a "why"** — describing the type alone adds no value. Explain the design decision.
- **Long doc lines** — documentation must fit in 100 characters. Wrap it.
- **Complex language in docs** — no em-dashes, semicolons, or multi-clause sentences. Break it up.
- **Out-of-order sections** — always follow the fixed section order.
- **Over-documenting obvious code** — documentation has a maintenance cost. If the code is clear, skip the comment.
- **Derived types in the Types section** — `z.infer` types belong immediately after their schema, not at the top.
