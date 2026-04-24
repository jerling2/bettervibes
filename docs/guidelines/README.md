# Documentation Guidelines

## Overview

Each concern in `docs/` maintains its own specification and changelog as a versioned pair. The spec is the authoritative document. The changelog captures the ongoing discussion between versions. Both files display the same version number at all times.

## File Structure

Each concern directory follows this layout:

```
docs/[concern]/
├── [concern].spec.v3.md              # Current authoritative spec
├── [concern].changelog.v3.md         # Ongoing discussion since current version
└── versions/
    ├── [concern].spec.v1.md       # Archived spec
    ├── [concern].changelog.v1.md  # Archived changelog
    ├── [concern].spec.v2.md
    └── [concern].changelog.v2.md
```

## How It Works

### Day-to-Day

When someone has a question, clarification, correction, or addition to a spec, they add an entry to the changelog. Each entry requires an author, date, and description. Follow the format in `CHANGELOG_TEMPLATE.md`.

Do not edit the spec directly for incremental changes.

### Monthly Merge

Once a month, the team reviews each concern's changelog and updates the spec. The process:

1. Review all changelog entries for the concern
2. Update the spec to incorporate the changes
3. Archive both the current spec and changelog into `versions/` with their version number (e.g., `api.spec.v2.md` and `api.changelog.v2.md`)
4. Bump the version number on the spec
5. Start a fresh changelog for the new version

### Versioning

The spec and changelog always share a version number — together they tell the story of how we arrived at our current solution. The spec is a snapshot of our thinking; any questions, clarifications, or addendums go into the changelog rather than editing the spec directly. Once a month, the team uses the changelog to bump the spec to the next version, and both files are archived into `versions/`. A new changelog is created to capture the ongoing discussion around the next version.

## Templates

Use these templates when creating new specs and changelogs:

| Template | Description |
| - | - |
[SPEC_TEMPLATE.md](./SPEC_TEMPLATE.md) | Required and optional sections for a spec |
[CHANGELOG_TEMPLATE.md](./CHANGELOG_TEMPLATE.md) |  Contribute guide for a changelog