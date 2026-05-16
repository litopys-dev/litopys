# Merge plan: `feat/memory-evolution`

## What this branch adds

`litopys evolve` — a maintenance command for an aging graph. Two
sub-features land together:

1. **Archive of tombstoned nodes.** Nodes whose `until` lies more than N
   days in the past (default 365) are moved out of the active graph into
   `<graphPath>/archive/`, preserving subdirectory layout. The move is
   recorded in `archive/manifest.jsonl` so it is auditable and reversible.

2. **Auto-apply high-confidence merge proposals.** Walks the quarantine
   directory for `merge-proposal` files, reads each proposal's
   `detectedBy: "similar:<score>"` provenance, and accepts every proposal
   whose score is at least `--min-similarity` (default 0.95) via the same
   `acceptMergeProposal` used by the manual review path. Manual proposals
   (`detectedBy: "manual"`) are skipped.

Both can be combined: `litopys evolve --archive-tombstoned --auto-merge`.

## Scope

Additive only — no `schemaVersion` bump, no schema changes, no new
dependencies.

### Core (`packages/core`)

- New `packages/core/src/graph/archive.ts`:
  - `archiveTombstoned(graphPath, opts)` — pure-Bun glob walk + atomic
    rename + append-only JSONL manifest.
  - Public types: `ArchiveOptions`, `ArchiveResult`, `ArchivePlanItem`,
    `ArchiveManifestEntry`.
- `packages/core/src/index.ts` re-exports the new symbols.

### Extractor (`packages/extractor`)

- New `packages/extractor/src/auto-merge.ts`:
  - `autoMergeProposals({ quarantineDir, graphPath, minSimilarity, dryRun })`
    walks `*.md`, sniffs merge-proposals via `isMergeProposalContent`, parses
    `detectedBy`, and calls `acceptMergeProposal` for each eligible file.
  - `parseSimilarity(detectedBy)` — small pure parser for the
    `"similar:<0..1>"` provenance string.
  - Per-file errors captured in `result.errors`, never thrown.
- `packages/extractor/src/index.ts` re-exports the new symbols.

### CLI (`packages/cli`)

- New `packages/cli/src/evolve.ts` — flag parsing + dispatch.
- `packages/cli/src/index.ts` — registers `evolve` and adds usage text.

### Docs

- New: `docs/memory-evolution.md`.

## Files

### New

- `packages/core/src/graph/archive.ts`
- `packages/core/test/archive.test.ts`
- `packages/extractor/src/auto-merge.ts`
- `packages/extractor/test/auto-merge.test.ts`
- `packages/cli/src/evolve.ts`
- `packages/cli/test/evolve.test.ts`
- `docs/memory-evolution.md`
- `MERGE_PLAN.md` (this file, overwrites the bi-temporal one)

### Modified

- `packages/core/src/index.ts` — re-export archive symbols.
- `packages/extractor/src/index.ts` — re-export auto-merge symbols.
- `packages/cli/src/index.ts` — wire `evolve` command + usage text.

## Tests

- Baseline (main): **512 / 512 pass**.
- After this branch: **549 / 549 pass** (`bun test`, 44 files).
- **37 new tests** across three files:
  - `packages/core/test/archive.test.ts` — 10 tests covering dry-run,
    actual move, subdirectory preservation, manifest format, idempotency,
    boundary (`until == cutoff` stays), bad inputs, `olderThan=0`, and the
    "files under `archive/` are never re-scanned" invariant.
  - `packages/extractor/test/auto-merge.test.ts` — 15 tests covering
    `parseSimilarity` (7 cases incl. edge values and rejects), threshold
    acceptance, below-threshold skip, dry-run preserves state, manual
    proposals skipped, non-merge files ignored, per-file error capture
    without aborting the run, invalid `minSimilarity` rejected.
  - `packages/cli/test/evolve.test.ts` — 12 tests covering empty-flag
    usage exit, archive flag end-to-end, auto-merge flag end-to-end,
    combined run, dry-run for each, and all four flag-validation paths.

New code line coverage:

```
packages/core/src/graph/archive.ts        100% funcs / 97.6% lines
packages/extractor/src/auto-merge.ts      100% funcs / 95.9% lines
packages/cli/src/evolve.ts                100% funcs / 95.0% lines
```

## Backward compatibility

- `schemaVersion` is **not** bumped.
- No existing files renamed or moved.
- No new dependencies added (Bun stdlib + Node `node:fs`/`node:path` only).
- Pre-existing 512 tests are untouched and all still pass.
- `litopys evolve` is a new sub-command; no other CLI verb changed
  behaviour.

## Commits

```
b909434 feat(evolve): archive tombstoned nodes via litopys evolve --archive-tombstoned
5e07a2f feat(evolve): auto-apply high-confidence merge proposals
c6dc5cb docs(cli): document evolve command in litopys usage text
ecba678 docs: memory-evolution feature reference
```

## Edge cases NOT covered

- **No graph-wide lock around archive.** `archiveTombstoned` uses atomic
  `rename(2)` per file and treats existing `archive/` content as
  read-only, so two concurrent `litopys evolve` invocations cannot
  corrupt anything; they may, however, both list the same candidate and
  one will lose the race with an `ENOENT`. The error surfaces and the
  next run is still correct. A coarser `withGraphLock` could be added if
  the operation grows.
- **`acceptMergeProposal` already takes `withGraphLock`,** so auto-merge
  inherits that protection.
- **Manifest is JSON-lines, not JSON.** A crashed run can leave the file
  with one trailing partial entry; readers should skip unparseable
  lines. We do not provide a "compact" or "rotate" command yet.
- **Reversibility is manual.** `manifest.jsonl` records everything
  needed to move a file back, but there is no `litopys evolve --restore <id>`
  helper. Adding one is a follow-up.
- **`--auto-merge` does not currently retry transient `acceptMergeProposal`
  failures.** A type conflict, for example, fails for good. Re-running
  the command will hit the same error on the same file.

## Suggested merge

```bash
git checkout main
git merge --no-ff feat/memory-evolution
```

No rebase needed — branch is fast-forward from `feat/bitemporal` (already
on `main`).
