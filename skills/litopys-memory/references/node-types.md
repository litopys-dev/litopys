# Node Types — choosing the right one

The graph has 6 types. Picking the wrong one is mostly harmless for reads but limits which relations are legal at write time.

## person

A human. Owners, collaborators, customers — anyone who has a stable identity in the user's world.

**Examples:** `owner`, `collaborator-alice`, `customer-acme`

**Outgoing relations allowed:**
- `owns` → project | system
- `prefers` → concept
- `learned_from` → lesson | event
- `uses` → system | project
- `mentioned_in` → event
- `conflicts_with` ↔ any
- `supersedes` → any

**Use when:** A new person becomes recurring in conversations.

## project

Something actively built, maintained, or run as a coherent unit of work.

**Examples:** `web-app`, `telegram-bot`, `api-service`, `data-pipeline`

**Outgoing relations allowed:**
- `uses` → system | project
- `runs_on` → system
- `depends_on` → project | system
- `mentioned_in` → event
- `conflicts_with` ↔ any
- `supersedes` → any

**Use when:** Coherent piece of work that will be referenced repeatedly. Not a one-off script.

**Don't use for:** Single files, throwaway experiments, generic concepts.

## system

Infrastructure or tooling — things that exist to support projects rather than being the project itself.

**Examples:** `prod-server`, `nginx`, `postgres`, `redis`, `docker`

**Outgoing relations allowed:**
- `uses` → system | project
- `runs_on` → system
- `depends_on` → project | system
- `mentioned_in` → event
- `conflicts_with` ↔ any
- `supersedes` → any

**Use when:** Underlying tech that multiple projects rely on. Hardware, services, frameworks-as-installed-instances.

**Project vs system:** If it ships value to end-users, it's a project. If it's plumbing, it's a system. `telegram-bot` is a project; the Redis cache it uses is a system.

## concept

A pattern, principle, preference, or idea that recurs across projects.

**Examples:** `simplicity-principle`, `tdd`, `api-first`, `monorepo-approach`

**Outgoing relations allowed:**
- `applies_to` → project | system | concept
- `mentioned_in` → event
- `conflicts_with` ↔ any
- `supersedes` → any

**Use when:** A practice, preference, or mental model worth crystallizing. Often appears as the target of `prefers` (from a person) or `applies_to` (from a lesson).

**Don't use for:** One-time decisions (those are events). Specific tools (those are systems).

## event

Something that happened at a specific point in time. Has a date.

**Examples:** `2026-04-24-v1-0-release`, `2026-03-15-db-migration`, `2026-02-10-outage`

**Outgoing relations allowed:**
- `reinforces` → concept
- `mentioned_in` → event
- `conflicts_with` ↔ any
- `supersedes` → any

**Use when:** Release, incident, decision-with-a-date, milestone. Anything where "when" is part of the meaning.

**Naming:** Prefix with date. `2026-04-22-event-name` sorts naturally and makes timing legible.

## lesson

Something learned, with a clear cause→effect. Usually arises from an event.

**Examples:** `premature-abstraction-cost`, `monolith-first`, `staging-parity-matters`

**Outgoing relations allowed:**
- `applies_to` → project | system | concept
- `reinforces` → concept
- `mentioned_in` → event
- `conflicts_with` ↔ any
- `supersedes` → any

**Use when:** "We tried X, it failed because Y, so we now do Z." The lesson IS the takeaway, not the incident itself.

**Lesson vs event:** The event is what happened. The lesson is what you took from it. An incident usually generates both: the `event` records the timeline, the `lesson` records the takeaway, linked by `learned_from` from the person to the lesson.

## Quick mapping: information → type

| You see... | Likely type |
|---|---|
| Name of a human | person |
| Name of a build/codebase | project |
| Name of a service/tool/framework instance | system |
| A practice, principle, preference | concept |
| Something with a date that happened | event |
| A takeaway from a problem solved | lesson |

## Tagging conventions

Tags are how searches that don't know exact names will find your node. Conventions:

- Project-scope tag: the project's codename (e.g. `web-app`, `api-service`)
- Domain tag: `auth`, `monitoring`, `storage`, `ui`, `mcp`, `infra`
- Status tag: `active`, `deprecated`, `wip`

Use lowercase, kebab-case for multi-word tags.
