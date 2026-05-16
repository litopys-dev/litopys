# Memory evolution

Once the graph carries thousands of nodes across multiple years it accumulates
two kinds of inertia:

1. **Tombstoned nodes** — anything with `until` set is no longer valid, yet its
   file still lives in the active tree, slowing scans and cluttering listings.
2. **Pending merge proposals** — `litopys propose-merge` queues candidates
   that match a node almost perfectly, but every one still demands a manual
   `quarantine accept`.

`litopys evolve` automates both, conservatively and idempotently.

```
litopys evolve --archive-tombstoned [--older-than 365] [--dry-run]
litopys evolve --auto-merge        [--min-similarity 0.95] [--dry-run]
litopys evolve --archive-tombstoned --auto-merge       # combined
```

With no flags the command prints usage and exits 1.

## Archive of tombstoned nodes

A node is considered ready for archive when

```
node.until && node.until < (today - olderThan)
```

Default `--older-than` is **365** days. Lowering it (`--older-than 30`) is
fine; raising it never archives less than the default would.

### File movement

The action preserves the original subdirectory layout, relative to the graph
root:

```
~/.litopys/graph/systems/old-laptop.md        →  ~/.litopys/graph/archive/systems/old-laptop.md
~/.litopys/graph/projects/discontinued.md     →  ~/.litopys/graph/archive/projects/discontinued.md
```

Files already under `archive/` are never re-scanned, so the operation is
idempotent: running it twice in a row produces zero new archives.

### Manifest (reversibility)

Every move appends one JSON line to `~/.litopys/graph/archive/manifest.jsonl`:

```json
{"id":"old-laptop","archived_at":"2026-05-16T12:34:56.000Z","original_path":"systems/old-laptop.md","until":"2024-06-01"}
```

The manifest is the audit trail and the recipe for un-archiving: move the
file back to `original_path` and the graph picks it up again on the next
`loadGraph()`.

### Dry-run

`--dry-run` prints the same plan (`Would archive N tombstoned node(s)…`) but
moves nothing and never touches `manifest.jsonl`.

## Auto-apply high-confidence merge proposals

`litopys propose-merge <a> <b>` writes a `merge-proposal` file into the
quarantine directory and tags it with `detectedBy: "similar:0.873"`. Manual
proposals get `detectedBy: "manual"`.

`litopys evolve --auto-merge` walks the quarantine directory, parses each
proposal's similarity, and calls the *same* `acceptMergeProposal()` used by
`litopys quarantine accept` for proposals whose score is at least
`--min-similarity` (default **0.95**).

### Conservative defaults

- The default threshold (0.95) intentionally accepts only obvious matches.
  Anything subtler stays in quarantine for review.
- Proposals without a parseable `similar:<score>` provenance are **always**
  skipped — manual proposals never get auto-merged.
- `acceptMergeProposal` refuses to merge nodes with different types; the
  resulting error is captured per file and surfaced in the run output, but
  one bad proposal does not abort the remaining work.
- The accepted proposal goes through the existing tombstone path: the loser
  node gets `until: <today>` and the proposal file is moved to
  `<quarantine>/archive/accepted-<original-name>`. The next
  `litopys evolve --archive-tombstoned` run will eventually move the tombstoned
  loser into the graph-side archive too, closing the loop.

### Dry-run

`--dry-run` lists what would be accepted (`Would auto-merge N proposal(s)…`)
without touching the graph or the quarantine.

## Combined run

`--archive-tombstoned --auto-merge` performs archive first, then auto-merge,
in a single command — useful as a cron / systemd-timer job.

## Idempotency guarantees

| Action | What makes it idempotent |
| --- | --- |
| `--archive-tombstoned` | Files under `archive/` are excluded from the scan, so re-runs find zero candidates. |
| `--auto-merge` | `acceptMergeProposal` moves the proposal file out of quarantine on success, so a second run does not re-see it. |
| `--dry-run` (either) | Performs no writes; can be repeated freely. |

## Output

Plain-text only (matches `litopys check`):

```
Archived 3 tombstoned node(s) older than 365 day(s) (scanned 218)
  retired-system: systems/retired.md -> archive/systems/retired.md (until=2024-01-15)
  ...

Auto-merged 2 proposal(s) at similarity >= 0.95 (scanned 5, skipped 3)
  merge-2026-…-thinkpad+lenovo-x240.md: lenovo-x240 -> thinkpad-x240 (similarity=0.973)
  ...
```

Errors appear in a trailing `Errors (N):` block, one per line. Non-zero
exit codes are reserved for argument-parsing failures; per-file errors
during auto-merge are reported and the command still exits 0.
