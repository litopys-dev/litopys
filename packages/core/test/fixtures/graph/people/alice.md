---
id: alice
type: person
summary: Generic test person fixture for loader and resolver tests
updated: "2026-01-01"
confidence: 1
aliases:
  - Test User
rels:
  owns:
    - acme-bot
    - server
  prefers:
    - token-economy
  learned_from:
    - chromadb-failure
tags:
  - owner
  - engineer
---

Synthetic test fixture. Do not edit structure — several tests in `packages/core/test/` depend on the id, relations, and tags declared here.
