# Changelog Template

## Contribution Guidelines

1. Every entry must contain a date, author, and a description. 
2. The author must be human, even if the entry was written by AI.
3. Do not use H1 or H2 headers in the entry's description.

## Entry Format
~~~markdown
## YYYY-MM-DD: Author

Description.
~~~

## The File Structure

A changelog file has three sections in order: YAML frontmatter, a prologue, and the entries list.

### YAML Frontmatter

Required fields:

| Field | Description |
| ----- | ----------- |
| `name` | Dot-separated identifier for the changelog (e.g. `frontend.changelog.v1`) |
| `created` | Date the file was created, in `YYYY-MM-DD` format |

~~~yaml
---
name: frontend.changelog.v1
created: 2026-03-31
---
~~~

### Prologue

After the frontmatter, paste the prologue below and update the title and description to match the specification this changelog covers.

~~~markdown
# Frontend Changelog

The changelog is an extension of the specifications; together they form the "true specification". Write your questions, corrections, or additions here. Do not edit the specification file on your own.

| Reference | Purpose |
| ---------- | ------- |
| [README.md](../guidelines/README.md) | Documentation Workflow |
| [CHANGELOG_TEMPLATE.md](../guidelines/CHANGELOG_TEMPLATE.md) | Changelog Contribution |
~~~

### Entries

After the prologue, add the `# Changelog` heading followed by entries in chronological order. When no entries exist yet, use the placeholder line.

~~~markdown
# Changelog

*This is the start of the changelog, but there are no entries yet.*
~~~

## Full Example

The following is a complete changelog file with one entry.

~~~markdown
---
name: frontend.changelog.v1
created: 2026-03-31
---

# Frontend Changelog

The changelog is an extension of the specifications; together they form the "true specification". Write your questions, corrections, or additions here. Do not edit the specification file on your own.

| Reference | Purpose |
| ---------- | ------- |
| [README.md](../guidelines/README.md) | Documentation Workflow |
| [CHANGELOG_TEMPLATE.md](../guidelines/CHANGELOG_TEMPLATE.md) | Changelog Contribution |

# Changelog

## 2026-03-31: Sarah Chen

The component loading states described in §3.2 don't account for partial
data — the spec only defines a binary loaded/unloaded state, but the
dashboard table needs to show stale data while a background refresh is in
progress. Proposing we add a third state: `stale`. Happy to draft the
updated state diagram if the team agrees on the direction.
~~~