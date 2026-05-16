# Merge plan: `feat/benchmark`

## What this branch adds

A first-class benchmark harness (`@litopys/bench`) so we can put numbers on
Litopys's retrieval quality and compare against Mem0 / Graphiti / Zep / Letta
once a real dataset adapter lands. The harness runs end-to-end in CI without
API keys thanks to a deterministic mock extractor.

## Scope

Additive only — no breaking changes, no schema bump.

### New workspace package — `packages/bench/`

- `src/scoring.ts` — pure `recallAtK`, `precisionAtK`, `mean` helpers with
  consistent edge-case handling (empty inputs, non-integer / negative k,
  precision@k divides by k).
- `src/dataset.ts` — zod-validated dataset loader. Built-in registry plus a
  `loadDatasetFile(path)` for ad-hoc datasets.
- `src/harness.ts` — `runBenchmark(dataset, opts)` orchestrates an isolated
  graph under `os.tmpdir()`, ingests sessions through the configured
  extractor, calls `toolSearch` + one-hop `toolRelated`, scores against
  `expected_node_ids`, and emits `BenchReport`. `formatReportMarkdown`
  prints the human summary; the JSON form lives in the report itself.
- `fixtures/synthetic.json` — 8 sessions, 15 questions covering people,
  projects, systems, concepts, lessons, events. Co-designed with the mock
  extractor so reproducible recall numbers are achievable.

### Mock extractor — `packages/extractor`

- New `MockAdapter` registered under `provider: "mock"` in
  `createAdapter()`. Pattern-based, deterministic, zero-network. Scans the
  transcript for `Person: …`, `Project: …`, `System: …`, `Concept: …`,
  `Lesson: …`, `Event: …` declarations and relation verbs
  (`X owns Y`, `X uses Y`, `X depends on Y`).
- `AdapterName` widened to include `"mock"`. Existing callers unchanged.

### CLI — `packages/cli`

- New `litopys bench` subcommand with flags `--dataset`, `--output`,
  `--limit`, `--provider`. Help text added to top-level usage.
- New workspace dep on `@litopys/bench`.

### MCP — `packages/mcp`

- Re-exports `SearchHit`, `LinkResult`, `ToolResult`, `ToolOk`, `ToolErr`
  types from `tools.ts`. No behaviour change; downstream packages (and now
  the bench harness) need them to type their pipelines without reaching
  into internal paths.

### Docs

- New: `docs/benchmark.md`.

## Files

### New

- `packages/bench/package.json`
- `packages/bench/tsconfig.json`
- `packages/bench/src/index.ts`
- `packages/bench/src/scoring.ts`
- `packages/bench/src/dataset.ts`
- `packages/bench/src/harness.ts`
- `packages/bench/fixtures/synthetic.json`
- `packages/bench/test/scoring.test.ts`
- `packages/bench/test/dataset.test.ts`
- `packages/bench/test/harness.test.ts`
- `packages/extractor/src/adapters/mock.ts`
- `packages/extractor/test/adapters/mock.test.ts`
- `packages/cli/src/bench.ts`
- `packages/cli/test/bench.test.ts`
- `docs/benchmark.md`
- `BENCHMARK_MERGE_PLAN.md`

### Modified

- `packages/extractor/src/adapters/factory.ts` — register `"mock"` provider.
- `packages/extractor/src/index.ts` — export `MockAdapter` and its options.
- `packages/extractor/test/adapters/factory.test.ts` — cover `"mock"`.
- `packages/mcp/src/index.ts` — re-export search/link result types.
- `packages/cli/package.json` — depend on `@litopys/bench`.
- `packages/cli/src/index.ts` — wire `bench` subcommand and usage text.
- `bun.lock` — workspace symlink resolution only; no new external deps.

## Tests

- Baseline (after merge of `feat/bitemporal`): **512 / 512 pass**.
- After this branch: **576 / 576 pass** (`bun test`, 46 files).
- 64 new tests:
  - `packages/bench/test/scoring.test.ts` — 23 tests on recall@k,
    precision@k, mean (empty inputs, k=0, non-integer / negative k,
    duplicates, k > retrieved length).
  - `packages/bench/test/dataset.test.ts` — 14 tests on the loader and the
    built-in registry (happy path, schema rejections, fallback name).
  - `packages/bench/test/harness.test.ts` — 5 integration tests including
    the full synthetic dataset (`recall@5 > 0.7`) and a `--limit 3` smoke
    run that completes in under 5s.
  - `packages/extractor/test/adapters/mock.test.ts` — 16 tests on
    `MockAdapter` patterns and the helpers (id normalisation, deduping,
    `existingNodeIds` filtering, `maxCandidates` cap).
  - `packages/extractor/test/adapters/factory.test.ts` — 1 new test for
    `"mock"` provider routing.
  - `packages/cli/test/bench.test.ts` — 5 tests on `cmdBench` (default
    output path, custom `--output`, error handling for unknown / missing /
    invalid flags). Stubs `@anthropic-ai/sdk` and `openai` at module load
    to prevent cache pollution that would otherwise break later tests.

## Sample run (mock provider, synthetic dataset)

```
# Litopys benchmark — synthetic

Provider: mock
Total questions: 15
Recall@5: 0.9778
Precision@5: 0.3200
Mean latency: 3.40ms
```

Precision is intentionally bounded by the fixture: most questions list 1–3
expected ids while the harness retrieves up to 5, so precision@5 caps near
the ratio of expected ids to k. This is the same pattern LongMemEval
exhibits — precision@k is best read as a "noise floor" indicator.

## Backward compatibility

- No schema changes. `schemaVersion` is **not** bumped.
- `AdapterName` widens from `"anthropic" | "openai" | "ollama"` to add
  `"mock"`. Strictly additive at the type level — existing callers compile
  unchanged.
- All 512 prior tests still pass untouched.

## Edge cases NOT covered

- **Real-LLM extraction is exercised in tests via stubs**, not against the
  live `anthropic` / `openai` providers. Running `litopys bench --provider
  anthropic` works but consumes tokens and produces non-deterministic
  numbers across runs; document this as a follow-up when we wire CI cost
  gates.
- **No standard external dataset adapter yet.** LongMemEval and LOCOMO have
  unstable schemas; the harness ships ready to consume them via the
  `--dataset path/to/converted.json` route, but the converter scripts are
  out of scope here.
- **No multi-run statistical aggregation.** Each invocation reports a
  single sample. Aggregate over runs with shell tooling for now; a
  `--repeat N` flag with mean / stddev would be a natural follow-up.
- **No per-relation-type metric.** Recall@k is computed against
  `expected_node_ids` only; we do not yet score retrieved edges.

## Suggested merge

```bash
git checkout main
git merge --no-ff feat/benchmark
```

No rebase needed — branch is fast-forward from current `main`
(`4ee0fe2 chore: release v0.1.5`).
