# Spec Template

## Contribution Guidelines

1. Use the changelog for incremental changes — do not edit the spec directly.
2. Include a Navigation Table at the top of the file.
3. §1 is always "The Conversation to Date".
4. Authors includes everyone who contributed to the spec, including changelog authors.
5. Sections after §1 should open with an intro paragraph (the "what"), followed by Purpose, Implementation, and Direction subheaders.

---

## Starting from Scratch (v1 only)

Use this template when no prior version of the spec exists. After v1, always start from the previous spec — do not use this template again.

~~~markdown
---
name: [concern].spec.v1
created: YYYY-MM-DD
authors: [Author Name]
---

# *[Concern] Specification for BetterVibes* — Version 1

## Navigation Table

| § | Topic |
| - | ----- |
| [1](#1-the-conversation-to-date) | The Conversation to Date |
| [2](#2-section-title) | Section Title |
| [3](#3-section-title) | Section Title |

---

## 1. The Conversation to Date

One or two sentences placing this concern in context: what it is, why it exists, and what this spec covers.

### 1.1. Context

Who is the primary stakeholder/human or consumer/application for this concern? What do they need, and how does this concern serve them?

### 1.2. Decisions

A bulleted list of key decisions made so far. Each bullet is a decision; sub-bullets explain the reasoning or tradeoff.

- Decision one.
    - Reason or tradeoff.
- Decision two.
    - Reason or tradeoff.

### 1.3. Deliverables

What this spec commits to delivering in the current version.

- Deliverable one.
- Deliverable two.

### 1.4. The Conversation Moving Forward

What open questions or future directions need to be resolved beyond v1? Reference other sections or concerns as needed.

---

## 2. Section Title

One sentence or short paragraph describing what this section covers — the "what".

### 2.1 Purpose (Why?)

Why does this exist? What problem does it solve?

### 2.2 Implementation (How?)

How is it built or structured? Include technologies, patterns, and constraints.

### 2.3 Direction (Where?)

How does this evolve in the next version? What stays the same and what changes?

---

## 3. Section Title

...
~~~

---

## Bumping the Version (v2 and beyond)

A new spec version is a modification of the previous one, not a rewrite. At the monthly merge, follow these steps:

1. **Archive** the current spec and changelog into `versions/` under their current version number.
2. **Open** the current spec and apply the changes described in the changelog entries.
3. **Update the frontmatter** — bump the version in `name`, update `created` to today's date, and add any new authors.
4. **Update the title** — bump the version number in the `# H1` heading.
5. **Start a fresh changelog** for the new version.

The spec carries its full history forward through edits — the `versions/` archive is the record of what it used to say.

---

## Optional Sections

These sections are not required but are encouraged where they add clarity.

### Architecture Overview

If the concern has multiple interacting layers or components, include an Architecture Overview section immediately after §1. Use an ASCII diagram to show the relationships. See `docs/frontend/frontend.spec.v1.md §2` for an example.

### Honorable Mentions

Use this as the final section to document alternatives that were considered and rejected. For each alternative, follow the standard subheader structure: Purpose, Implementation (including conflicts), and Direction.
