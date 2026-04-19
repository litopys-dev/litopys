---
id: app-a
type: project
summary: Application A that conflicts with but also uses system-b
updated: "2026-04-19"
confidence: 1
rels:
  conflicts_with:
    - system-b
  uses:
    - system-b
---

App A has a logical contradiction: it both conflicts_with and uses system-b.
