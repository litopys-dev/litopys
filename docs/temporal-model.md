# Bi-temporal model

Litopys tracks **two independent time axes** per node:

| Axis | Field(s) | Meaning |
| --- | --- | --- |
| Document time | `updated` | When this node was last written to the graph. Always required. |
| Event time | `occurred_at`, `since`, `until` | When the underlying fact was true *in the world*. All optional. |

This lets us answer "what was true about the server **in March**?" even if the
node recording that fact was last edited in May.

## Frontmatter fields

```yaml
---
id: ram-8gb
type: system
updated: "2026-04-20"          # document time (required)
confidence: 1
occurred_at: "2024-08-01"       # event time (optional)
since: "2024-08-01"             # start of validity (optional)
until: "2026-04-20"             # end of validity (optional; half-open)
---
```

All three event-time fields are optional ISO dates (`YYYY-MM-DD`). Existing
nodes that lack them keep working unchanged.

### `occurred_at`

When the recorded fact actually happened. Use this for one-shot events that
do not have a duration:

```yaml
id: 2026-04-22-disk-failure
type: event
occurred_at: "2026-04-22"
updated: "2026-04-23"   # we recorded it the next day
```

If `occurred_at` is missing, the effective event time falls back, in order, to:

1. `since`
2. The ISO date prefix of the node id (for `type: event` only — e.g. `2026-04-22-deploy` ⇒ `2026-04-22`)
3. `updated`

### `since` / `until`

A node's validity interval is half-open: **`[since, until)`**.

- `since` undefined ⇒ no lower bound (the node has always been valid).
- `until` undefined ⇒ still valid (currently open).
- `until = D` ⇒ the node was valid **up to but not including** `D`.

The half-open interval matches the supersedes auto-close semantics
(`B.until = A.since` — A picks up exactly where B left off, no overlap).

## As-of queries

Both `litopys_search` and `litopys_related` accept an optional `as_of` parameter:

```jsonc
// "What was true about RAM in March 2026?"
{
  "tool": "litopys_search",
  "input": { "query": "ram", "as_of": "2026-03-15" }
}
```

Filtering rule: a node passes when
`(since === undefined || since <= as_of) AND (until === undefined || until > as_of)`.

`litopys_related` applies the same rule to every neighbour discovered during
BFS; tombstoned neighbours simply do not appear and their edges are not
traversed.

## Supersedes auto-closure

The `supersedes` edge means *"A is the newer version of B"*.

When `litopys_link { relation_type: "supersedes", source_id: A, target_id: B }`
is called, the link tool will, in addition to creating the edge:

- If `B.until` is **not** set: write `B.until = A.since ?? A.updated` and
  return `auto_closed: { node: B, until: ... }`.
- If `B.until` is **already** set: leave it untouched and return a `warnings`
  array explaining why.

This means a clean chain of versions automatically maintains a contiguous
event-time timeline:

```
v1 (since=2025-01-01) ─supersedes─→  v2 (since=2025-06-01) ─supersedes─→  v3 (since=2026-04-01)
                until=2025-06-01                   until=2026-04-01                  until=(open)
```

`litopys_search { as_of: "2026-05-01" }` returns only `v3`.

## Migration

For existing graphs that pre-date the bi-temporal fields:

```bash
litopys check --fix-temporal              # apply
litopys check --fix-temporal --dry-run    # preview the plan
```

The migration is **idempotent**:

- Nodes that already have `occurred_at` are skipped.
- For `type: event` nodes whose id is date-prefixed (`YYYY-MM-DD-…`), the
  prefix is used.
- All other nodes get `occurred_at = updated`.

Running the command twice produces no changes the second time.

## Backward compatibility

- `schemaVersion` is **unchanged**. The new fields are additive and optional.
- Old nodes load and validate as before; only their as-of query behaviour
  differs (they default to "always valid" when `since`/`until` are absent).
- Tools that did not pass `as_of` behave exactly as they did before.
