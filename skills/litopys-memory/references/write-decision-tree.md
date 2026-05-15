# Write Decision Tree

When new information arrives, choose ONE path. Never silently overwrite — that's how the graph rots.

## The decision

```
New information arrives
        │
        ▼
litopys_search → does a similar node exist?
        │
   ┌────┴────┐
   │         │
  YES       NO
   │         │
   ▼         ▼
Is the    litopys_create
existing  + litopys_link to related nodes
fact      (DONE)
still
true?
   │
   ├── YES, just added detail ──► Don't create. Update body via dashboard or skip.
   │
   ├── YES, but conflicts ─────► litopys_create new node + link with conflicts_with.
   │   (both alive, different
   │    contexts)
   │
   └── NO, fact has changed ────► litopys_create new node + link NEW --supersedes--> OLD.
       (RAM upgraded, version       ("A supersedes B" means A is the
        bumped, role changed)        current/new node — outgoing edge
                                     from the new node points to the old)
```

## Constraint matrix — what edges are legal

The graph rejects invalid links. Reference before calling `litopys_link`:

| Relation | Source types | Target types | Symmetric |
|---|---|---|---|
| `owns` | person | project, system | no |
| `prefers` | person | concept | no |
| `learned_from` | person | lesson, event | no |
| `uses` | person, project, system | system, project | no |
| `applies_to` | concept, lesson | project, system, concept | no |
| `runs_on` | project, system | system | no |
| `depends_on` | project, system | project, system | no |
| `reinforces` | event, lesson | concept | no |
| `mentioned_in` | any | event | no |
| `conflicts_with` | any | any | YES |
| `supersedes` | any | any | no (new → old; "A supersedes B" = A is current) |

If the relation you want isn't in the table, the link will be rejected. Pick the closest legal one or skip the link.

## Quality gate

Before `litopys_create`:

- **Confidence ≥ 0.7.** If you're not sure, don't create. The extractor + quarantine will catch durable facts later.
- **kebab-case id.** `api-monitoring`, not `Api Monitoring` or `api_monitoring`.
- **Type matches reality.** See `node-types.md` for the mapping.
- **Body is concise.** What it is + why it matters. Not a transcript.
- **Has at least one tag.** Tags are how future searches will find this.

## Worked examples

### Example 1: Server RAM upgraded

**Old state:** node `prod-server` says "4 GB RAM"
**New fact:** RAM upgraded to 8 GB

**Wrong:** Update `prod-server.md` body and bump `updated`. Loses history — anyone reading old logs that reference the 4 GB constraint can't see when or why it changed.

**Right:**
```
litopys_create({
  id: "prod-server-8gb",
  type: "system",
  summary: "Server upgraded to 8 GB RAM",
  updated: "<today>",
  confidence: 0.95,
  body: "...",
  tags: ["server", "ram"],
})

litopys_link({
  from: "prod-server-8gb",   # NEW node
  relation: "supersedes",
  to: "prod-server",          # OLD node
})
```

**Reading rule:** `supersedes` is directional — "A supersedes B" reads naturally: A is newer, replaces B. The outgoing edge always lives on the **new** node. Both nodes stay alive, but readers should cite only the new one.

### Example 2: New project starts

**New fact:** owner starts working on `analytics-dashboard`

```
litopys_search("analytics-dashboard")
→ no match

litopys_create({
  id: "analytics-dashboard",
  type: "project",
  summary: "Analytics dashboard for tracking user metrics",
  updated: "<today>",
  confidence: 0.9,
  tags: ["analytics", "dashboard"],
})

litopys_link({ from: "owner", relation: "owns", to: "analytics-dashboard" })
litopys_link({ from: "analytics-dashboard", relation: "depends_on", to: "api-service" })
```

Two links: ownership and dependency. Don't leave the node isolated.

### Example 3: Conflicting facts both alive

**Existing:** node `app-storage` uses SQLite
**New fact:** decided to also pilot Postgres for analytics, both running

This is NOT a supersede — both are real, different purposes. Use `conflicts_with`:

```
litopys_create({
  id: "app-postgres-pilot",
  type: "project",
  summary: "Postgres pilot for analytics, running alongside SQLite",
  ...
})

litopys_link({
  from: "app-postgres-pilot",
  relation: "conflicts_with",
  to: "app-storage",
})
```

Future readers see both, see the tension, can ask which is current for a given use case.

### Example 4: When NOT to write

User says: "today I'm running the app in dev mode on port 5050"

**Don't create.** Port number is volatile. Dev mode is mid-conversation state. Confidence on durability is low. Let the extractor decide if anything here is worth quarantining.

User says: "we're standardizing on Bun for all new projects, no more Node"

**Do create.** This is a stable preference/decision. Create a `concept` or `lesson` node with the rationale, link the owner with `prefers`.

## Common mistakes

- Creating a node without searching first → duplicates the graph
- Updating an existing node's body to reflect a changed fact → loses history, breaks `supersedes` chains
- Linking with a relation that doesn't fit the constraint matrix → rejected by validator
- Creating low-confidence speculation → pollutes the graph; let quarantine handle it
- Forgetting to link a new node → orphan, won't surface in `related`
