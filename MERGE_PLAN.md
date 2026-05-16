# Merge plan: `feat/bitemporal`

## What this branch adds

Bi-temporal model (document time + event time) for the Litopys knowledge
graph, plus as-of queries and automatic `supersedes` chain closure.

## Scope

Additive only — no `schemaVersion` bump.

### Schema (`packages/core`)

- `BaseNodeSchema` gains one new optional field: `occurred_at` (ISO date).
- `since` and `until` (already present but loosely typed) now carry explicit
  ISO-date regex validation and error messages.
- New helpers exposed from `@litopys/core`:
  - `resolveOccurredAt(node)` — fallback chain `occurred_at → since → id-prefix (events) → updated`.
  - `isValidAsOf(node, isoDate)` — half-open `[since, until)` validity check.
  - `eventDateFromId(id)` — extract `YYYY-MM-DD` prefix from event ids.
  - `isIsoDate(s)`.

### MCP tools (`packages/mcp`)

- `litopys_search` and `litopys_related` accept optional `as_of: string` (ISO
  date). Nodes / neighbours whose validity interval does not contain `as_of`
  are filtered out.
- `litopys_create` accepts `occurred_at`, `since`, `until`.
- `litopys_link` with `relation_type: "supersedes"` now auto-closes the
  target's `until` to `source.since ?? source.updated` when the target has no
  `until` set. Returns `auto_closed: { node, until }` on success and a
  `warnings` array when the target was already tombstoned.

### CLI (`packages/cli`)

- `litopys check --fix-temporal [--dry-run]` — idempotent backfill of
  `occurred_at`:
  - event nodes whose id is date-prefixed → id prefix
  - everything else → `updated`
  - nodes that already have `occurred_at` are skipped.

### Docs

- New: `docs/temporal-model.md`.

## Files

### New

- `packages/core/src/graph/temporal.ts`
- `packages/core/test/temporal.test.ts`
- `packages/mcp/test/temporal.test.ts`
- `packages/cli/test/check-temporal.test.ts`
- `docs/temporal-model.md`
- `MERGE_PLAN.md`

### Modified

- `packages/core/src/schema/base.ts` — add `occurred_at`, tighten regex error messages on `since`/`until`.
- `packages/core/src/index.ts` — re-export temporal helpers.
- `packages/mcp/src/tools.ts` — `as_of` on search/related, new create fields, supersedes auto-close in link.
- `packages/cli/src/check.ts` — `migrateTemporal()` + `--fix-temporal [--dry-run]` flag handling.
- `packages/cli/src/index.ts` — usage text.

## Tests

- Baseline (master): **481 / 481 pass**.
- After this branch: **512 / 512 pass** (`bun test`, 41 files).
- 31 new tests across three files:
  - `packages/core/test/temporal.test.ts` — schema validation, fallback chain, half-open interval semantics, ISO-date guards (15 tests).
  - `packages/mcp/test/temporal.test.ts` — create persists new fields, as-of filtering on search & related, supersedes auto-close (incl. 3-node chain), tombstone warning, non-supersedes left untouched (10 tests).
  - `packages/cli/test/check-temporal.test.ts` — migration: non-event ⇒ updated, event w/ id-prefix ⇒ prefix, event w/o prefix ⇒ updated, idempotence, dry-run does not write (5 tests).

## Backward compatibility

- `schemaVersion` is **not** bumped.
- Every new field is optional.
- Old nodes load and validate unchanged.
- Tools called without `as_of` behave exactly as before.
- Existing 481 tests are untouched and all still pass.

## Edge cases NOT covered

- **`occurred_at > until`** — the schema does not currently reject a node
  whose recorded event time is past the end of its own validity interval.
  Real-world data may legitimately do this (e.g. a fact discovered after a
  system was retired), so I chose not to add the constraint without
  discussion. Could land in a follow-up.
- **Edge-level temporal validity** — edges currently have no `since`/`until`
  of their own; they inherit endpoint validity transitively. This is enough
  for the stated use case but a future "edge expired in March" requirement
  would need its own model.
- **Time-zone semantics** — all dates are calendar-day strings with no zone.
  Two events on the same day are unordered relative to each other. Matches
  the existing `updated` convention.

## Suggested merge

```bash
git checkout main
git merge --no-ff feat/bitemporal
```

No rebase needed — branch is fast-forward from current `main`.
