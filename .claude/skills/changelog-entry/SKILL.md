---
name: changelog-entry
description: >-
  Add structured entries to a spec's changelog file.
  Formats the entry with author, date, and description
  per the CHANGELOG_TEMPLATE.md and appends it to the
  correct changelog. TRIGGER when: user wants to add a
  note, question, clarification, amendment, or any
  discussion point to a spec's changelog. Also trigger
  when user says "log this", "add to changelog", "note
  for the spec", or references updating a changelog.
  DO NOT TRIGGER when: user is editing a spec directly,
  creating a new spec, or performing the monthly merge.
---
 
# Changelog Entry
 
Help team members quickly add well-formatted entries to a spec's changelog.
 
## When to Activate
 
- User wants to add a question, clarification, or amendment to a spec
- User says "log this", "add to changelog", "note for the spec"
- User references a concern (backend, frontend, api, architecture, data) and wants to record a discussion point
- User asks to update a changelog
 
**Do not use** when the user is editing a spec directly, creating a new spec from scratch, or performing the monthly merge and archive process.
 
## Workflow
 
1. Identify which concern the entry belongs to. If unclear, ask the user.
2. Read `docs/guidelines/CHANGELOG_TEMPLATE.md` for the current entry format.
3. Read the relevant spec file (e.g., `docs/orchestration/orchestration.spec.v1.md`) to confirm the current version and context.
4. Collect the following from the user if not already provided:
   - **Author**: Who is adding this entry
   - **Description**: What the entry says
5. Use today's date for the entry.
6. Format the entry per the CHANGELOG_TEMPLATE.md.
7. Append the entry to the matching changelog file at the same version (e.g., `docs/orchestration/orchestration.changelog.v1.md`).
8. Confirm the entry was added and show the user what was written.
 
## Patterns
 
```markdown
## 2026-03-31: Sarah Chen
 
The component loading states described in §3.2 don't account for partial
data. The spec only defines a binary loaded/unloaded state, but the table
needs to show stale data while a background refresh is in progress.
Proposing a third state: `stale`.
```
 
## Anti-Patterns
 
- **Editing the spec directly**: Incremental changes go in the changelog, not the spec.
- **Missing author**: Every entry needs a name. Do not default to "Anonymous" — ask.
- **Vague descriptions**: "Updated the API" tells a future reader nothing. Entries should capture the reasoning, not just the change.
- **Duplicate entries**: Read the existing changelog before appending. If a similar entry already exists, ask the user if they want to amend it or add a new one.
 
## Structure
 
Changelog files live co-located with their spec, and both files share a version number:
 
```
docs/[concern]/
├── [concern].spec.v{N}.md         # Current authoritative spec
├── [concern].changelog.v{N}.md    # Ongoing discussion since current version
└── versions/                      # Archived spec/changelog pairs (created on monthly merge)
    ├── [concern].spec.v1.md
    └── [concern].changelog.v1.md
```

Append entries to the *current* version's changelog. Archived versions under `versions/` are read-only.

## References
 
- Read `docs/guidelines/CHANGELOG_TEMPLATE.md` for entry format
- Read `docs/guidelines/README.md` for how changelogs fit into the versioning workflow
- Read the relevant concern's spec file for context before writing the entry