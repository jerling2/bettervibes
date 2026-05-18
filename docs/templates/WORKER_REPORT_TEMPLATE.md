---
model: <AI model, e.g., Claude Opus 4.7>
prd-source: <path relative to project root, e.g., docs/prds/PRD-NN-<slug>-v1.md>
date: YYYY-MM-DD
status: red | green
---

# Worker Report: <feature-slug>

## Executive Summary

<Two-to-five sentences. What was attempted, what landed, what didn't, and the
recommended decision (greenlight or redlight). Lift only what's already
established in the sections below.>

## Implementation

*What the worker actually did.*

- <action / change>
- <action / change>

## Files Touched

*Created, modified, or deleted in this iteration.*

- `path/to/file.ts` — <one-line summary>
- `path/to/another.ts` — <one-line summary>

## Acceptance Criteria Status

*Mirror each criterion from the source task's `## Acceptance Criteria`. Drop
this section if the task did not declare criteria.*

- **<criterion>** — met | unmet | partial — <one-line evidence>
- **<criterion>** — met | unmet | partial — <one-line evidence>

## Locked-in Decisions

*Decisions the worker made when the spec did not resolve a choice it faced.
Each entry captures the gap, the call, and the reasoning — so future
iterations can see why the choice is now binding.*

- **<decision>** — Spec did not specify <X>. Worker chose <Y> because
  <reason>.
- **<decision>** — Spec did not specify <X>. Worker chose <Y> because
  <reason>.

## Open Questions

*Deviations from the spec, ambiguities, or anything to flag for the human
reviewer. Leave genuinely open — do not propose tentative answers.*

Q1: <question>?
Q2: <question>?

## Appendix A: Worker's Narrative

*First-person account in the register of `/talk-thoughtfully` and
`/record-conversation`. Stay grounded in what the worker actually did and
decided. Do not claim interior experience (no "felt", "noticed", "sensed").*

<narrative>
