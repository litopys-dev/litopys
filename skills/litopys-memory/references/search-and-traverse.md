# Search and Traverse — beyond flat queries

The graph's value is in edges. A search that doesn't traverse misses 80% of what's stored.

## The full pipeline

```
litopys_search    →  candidate nodes by keyword
litopys_get       →  full body of a specific node
litopys_related   →  connected subgraph (MANDATORY for non-trivial questions)
```

Skipping `litopys_related` turns the graph into a flat note-taking system. That's the failure mode this skill exists to prevent.

## When `related` is mandatory

| Question type | Why traversal matters |
|---|---|
| "What are we working on?" | Active projects link to recent events, blockers, lessons — flat search misses the lessons |
| "Why did we choose X?" | The reason is in `learned_from` or `reinforces` edges, not in the node body |
| "What depends on this?" | `depends_on` and `runs_on` only visible via traversal |
| "Is this still current?" | `supersedes` chains hidden until you walk them |
| "What problems do we have here?" | `conflicts_with` edges flag known tensions |

## When `related` can be skipped

- Pure lookup: "what's the owner's email" — get the person node, done
- Existence check: "do we have a node for X" — search alone is enough
- Already in a deep traversal — don't recurse infinitely

## Temporal awareness

Every node has `updated`, optional `since`, optional `until`. Edges can carry `supersedes`.

**Outgoing `supersedes`** — this node IS the current one, the target is the old version it replaced. Cite the source, not the target.

```
node-a --supersedes--> node-b
   ↑
this is current
(target node-b is the old/replaced version)
```

**Incoming `supersedes`** — something newer points at you. You are stale; jump to the source and cite that instead.

**`until` field set in the past** — node is tombstoned. Ignore unless explicitly asked about historical state.

**Conflicting facts both alive** — check timestamps. Newer `updated` usually wins, but check `confidence` too. If both are high-confidence and live, that's a real conflict — surface it to the user instead of picking silently.

## Query formation patterns

### Pattern 1: Identifier first

If you know a name/codename, try it directly:
```
litopys_search("my-app")
litopys_search("api-service")
litopys_search("prod-server")
```

These hit aliases. One-shot, deterministic.

### Pattern 2: Type + tag

When you know the category but not the name:
```
litopys_search("server")     # systems tagged 'server'
litopys_search("auth")       # whatever applies_to auth
litopys_search("incident")   # events tagged 'incident'
```

### Pattern 3: Semantic fallback

When the user's phrasing doesn't match anything:
```
"when did the bot go down?"  →  litopys_search("bot incident")
"what did we decide about the database?"  →  litopys_search("database decision")
```

Two-three keywords from the user's intent, not their literal phrase.

## Worked example: "remember why we dropped that library?"

**Wrong:**
```
litopys_search("library-x")
→ found library-x-failure lesson
→ "Yeah, you dropped it because of performance"
```

This misses everything important: what the actual problem was, what replaced it, when, what was learned for future stack choices.

**Right:**
```
litopys_search("library-x")              # finds library-x-failure
litopys_related("library-x-failure")     # gets:
                                         #   reinforces  → simplicity-principle
                                         #   applies_to  → my-app
                                         #   supersedes  → (none — library-x is dead)
                                         #   mentioned_in → event nodes
litopys_get("simplicity-principle")      # core lesson body
```

Now the answer cites: cause, what was learned, what it shaped, and contemporaneous events.

## Common mistakes

- **One-keyword search for ambiguous terms.** "memory" can match RAM, a memory library, a lesson — refine to 2-3 words
- **Searching the user's literal phrase.** Translate to graph vocabulary first
- **Stopping at first hit.** If the first result has low relevance, search again with different keywords before traversing
- **Walking too far.** `related` returns a subgraph; don't recursively call `related` on every neighbor
