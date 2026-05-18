# BetterVibes

## Skills
Skills are located in the `.claude/skills/` directory. Read the relevant SKILL.md before working on any area of the codebase.

## Contributor warnings

`bettervibes update` does not overwrite an existing
`bv_orchestration/BETTER_VIBES.md` in a consumer project (seeded-file
semantics — see `src/manifest.ts`). Editing
`docs/templates/BETTER_VIBES_TEMPLATE.md` is therefore a breaking change for
existing consumers: their `BETTER_VIBES.md` will not pick up the new content
via `update`. Any such edit requires a major version bump plus a CHANGELOG
note instructing downstream consumers to diff `BETTER_VIBES_TEMPLATE.md`
against their `BETTER_VIBES.md` and manually merge.
