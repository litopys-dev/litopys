---
name: litopys-memory
description: Use whenever the conversation involves the user's projects, systems, infrastructure, people, past decisions, or recurring problems — even when memory is not explicitly mentioned. Trigger on possessives and project references ("my project", "our server", "remember when we", "last time"), named systems and services in the user's graph (check litopys://startup-context for the exact names), references to past discussions, factual claims about the user's setup, or new stable knowledge worth recording. Always consult the graph before stating facts about user-specific things; record durable knowledge using the decision tree. Skip for generic programming/library questions unrelated to the user's stack.
---

# Litopys Memory

Persistent graph memory across sessions. The MCP server already injects 5 baseline rules (SEARCH FIRST · CREATE ON LEARNING · LINK AFTER CREATING · AVOID DUPLICATES · QUALITY THRESHOLD). **This skill goes further** — covers what those rules don't: graph traversal, temporal awareness, conflict resolution, constraint-aware writes.

## Customize this skill

After installing, open `SKILL.md` and replace the generic trigger description above with the **exact project and system names from your graph**. Run `litopys startup-context` or ask `litopys_search("projects")` to see them. This makes the skill fire at the right moments instead of relying on generic phrasing.

## Iron Law

**No factual claim about user-specific things without searching the graph first.**

Applies to: the user's projects, systems, infrastructure, people, past decisions, recurring problems.

Does NOT apply to: generic programming questions, library docs, syntax, code review unrelated to the user's stack.

## Four Disciplines

### 1. Reading — Search + Traverse (top pain)

Plain `litopys_search` returns flat results. The graph carries meaning in **edges**. Every search must be followed by traversal when the answer needs context.

```
Step 1: litopys_search("keyword")     → find candidate nodes
Step 2: litopys_get(id)               → full body if needed
Step 3: litopys_related(id)           → MANDATORY for any non-trivial answer
Step 4: Check supersedes chains       → incoming supersedes = node is outdated, jump to the newer source
Step 5: Check until field             → until < today = tombstoned, ignore
```

**Red flag:** answering after step 1 alone. If you didn't traverse, you're using the graph as a flat key-value store — exactly the failure mode this skill exists to prevent.

Details and examples → `references/search-and-traverse.md`

### 2. Writing — Decide before creating

Three mutually exclusive paths when new information arrives:

| Situation | Action |
|---|---|
| Genuinely new entity, no similar node found | `litopys_create` + `litopys_link` |
| Existing fact has changed (RAM upgraded, version bumped, role changed) | Create new node, `litopys_link` with `supersedes` from NEW to OLD ("new supersedes old") |
| Two facts disagree but both valid in different contexts | `litopys_link` with `conflicts_with` |
| Same thing already exists | Don't create — update the existing node body via dashboard or skip |

Never silently overwrite a node. History matters — `supersedes` preserves it.

Decision tree with worked examples → `references/write-decision-tree.md`

### 3. Observation — When to record

Record only **durable** facts. The extractor + quarantine handle most extraction; manual `litopys_create` is for facts the model is highly confident about right now.

Record:
- New person/project/system that will recur
- A lesson with a clear cause→effect (why we abandoned X for Y)
- An event with a date (release, incident, decision)
- A stable preference/practice

Don't record:
- Mid-conversation reasoning, intermediate thoughts
- File paths, port numbers, temporary state
- Anything with confidence < 0.7
- Restatement of something already in the graph

### 4. Query formation — find the right node

`litopys_search` is full-text over name, aliases, body, tags. To find what you need:

- **2-4 distinctive keywords**, not phrases. "project status" beats "tell me about my projects"
- **Try the alias first**: project codenames, system shortnames
- **Fall back to type+tag**: search common tag like "server", "auth", "monitoring"

Patterns and gotchas → `references/search-and-traverse.md`

## Constraint Cheatsheet — what links what

The graph rejects invalid relations. Quick reference:

```
owns:           person → project | system
uses:           person | project | system → system | project
runs_on:        project | system → system
depends_on:     project | system → project | system
applies_to:     concept | lesson → project | system | concept
prefers:        person → concept
learned_from:   person → lesson | event
reinforces:     event | lesson → concept
mentioned_in:   any → event
conflicts_with: any ↔ any  (symmetric)
supersedes:     any → any  (directional: A supersedes B → A is the newer/current node)
```

Full table with examples → `references/node-types.md`

## Workflow at session start

```
First user message
    │
    ▼
Is it user-specific?  ── no ──► answer normally
    │ yes
    ▼
litopys_search(topic) — parallel searches for relevant entities
    │
    ▼
For each promising result: litopys_related(id)
    │
    ▼
Compose answer using BOTH: search hits + related context
    │
    ▼
New durable fact emerged?  ── no ──► done
    │ yes
    ▼
Decision tree: create | supersedes | conflicts_with | skip
```

## Red Flags — STOP and search

| Thought | What to do |
|---|---|
| "I remember from earlier..." | Search anyway. Earlier-in-context ≠ in-graph. |
| "This is just a follow-up question" | Search if it touches user-specific things. |
| "startup-context already showed me this" | It's a stale snapshot. Verify. |
| "I'll search if I'm wrong" | Too late. Search before claiming. |
| "It's a quick question" | Quick wrong answer is worse than slow right one. |
| "I'll just use search, no need for related" | Flat use defeats the graph. Traverse. |

## Quick Reference

| Want to... | Tool | Notes |
|---|---|---|
| Find by name/keyword | `litopys_search` | Full-text; use 2-4 distinctive words |
| Get one node | `litopys_get` | By id or alias |
| Walk the graph | `litopys_related` | BFS, returns connected subgraph |
| Add a node | `litopys_create` | Only after search confirms no dup |
| Add a relation | `litopys_link` | Use after create; check constraint table |

## Anti-Patterns

- ❌ Answer about user's project from memory of last session
- ❌ `litopys_search` then answer (skipped `related`)
- ❌ Overwrite a node when fact changes (use `supersedes`)
- ❌ Create node with confidence < 0.7
- ❌ Long phrase as search query — prefer 2-4 keywords
- ❌ Citing startup-context as authoritative without verifying
