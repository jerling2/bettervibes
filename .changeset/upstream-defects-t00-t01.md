---
"bettervibes": minor
---

Fix a batch of defects surfaced while running BV on a mid-stream repo:

- `bettervibes init` now idempotently writes `bv_orchestration/checkpoint.sqlite*`
  to the project `.gitignore` (creating it if absent) instead of only printing a
  reminder.
- `clearThread` runs `PRAGMA wal_checkpoint(TRUNCATE)` on greenlight so the
  SQLite WAL no longer grows unbounded across tasks.
- Worker-report filenames and `date:` fields now use the operator's local
  timezone instead of UTC (`todayYmd`), fixing day-early rollover west of UTC.
- The inventory script gains an `iterations` column (count of worker reports
  per task) to surface thrashy tasks.
- The task template defaults `idempotency_check` to `true`, and the pre-flight
  idempotency instruction now tells the worker to check for duplicate/sibling
  packages and configs before creating new ones.
- The worker-report `status:` field is renamed to `self_assessment:` to stop it
  reading like the reviewer's verdict; `BETTER_VIBES.md` now documents the
  report frontmatter and clarifies that the reviewer's verdict is recorded by
  the task's location, not the report.
- `bettervibes run` detects operator-owned tasks (a `## Touches` section that
  names only external systems and no repo file paths) and refuses with a
  `refused` event unless `--force` is passed.
