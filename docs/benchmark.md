# Benchmark harness

`@litopys/bench` runs Litopys against a memory-retrieval dataset and reports
recall, precision, and latency. It is the foundation we will use to compare
Litopys to competing graph-memory systems (Mem0, Graphiti, Zep, Letta) once a
shared dataset adapter lands.

The harness ships with one small synthetic dataset so the whole pipeline can
be exercised in CI without API keys.

## Running

```bash
# All defaults — synthetic dataset, mock extractor, ./bench-report.json
litopys bench

# Smoke run over the first three questions
litopys bench --limit 3

# Custom dataset and output
litopys bench --dataset path/to/my-dataset.json --output reports/my-run.json
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--dataset <name\|path>` | `synthetic` | Built-in dataset name or path to a JSON file in the dataset format described below. |
| `--output <path>` | `./bench-report.json` | Where the JSON report is written. Parent directories are created on demand. |
| `--limit <N>` | (no limit) | Evaluate only the first `N` questions. Use for smoke runs. |
| `--provider <name>` | `mock` | Extractor provider. Valid: `mock`, `anthropic`, `openai`, `ollama`. Non-mock providers require the matching API key / endpoint env vars and are subject to the usual cost / rate limits. |

The command always prints a markdown summary to stdout and writes the full
per-question breakdown to the JSON file.

## What the harness does

1. Creates an isolated graph directory under `os.tmpdir()` — `~/.litopys` is
   never touched.
2. For each session in the dataset, builds a transcript from the messages and
   feeds it through the configured extractor. The extracted candidate nodes
   and relations are persisted directly to the temp graph (the harness skips
   the human quarantine workflow because dataset answers are already known).
3. For each question, calls `litopys_search` against the temp graph, then
   expands one hop with `litopys_related` from the top hit, mirroring how a
   real consumer would assemble context.
4. Scores the merged retrieved-id list against the question's
   `expected_node_ids` using recall@k and precision@k (k = 5 by default) and
   records `search + related` latency in milliseconds.
5. Writes the JSON report, prints the markdown summary, and deletes the temp
   graph.

## Metrics

| Metric | Formula | Notes |
| --- | --- | --- |
| `recall@k` | `\|expected ∩ top-k(retrieved)\| / \|expected\|` | Returns 0 when the dataset declares no expected ids (we never let `0/0` propagate to the aggregate). |
| `precision@k` | `\|expected ∩ top-k(retrieved)\| / k` | Divides by `k`, not by `min(k, len(retrieved))`. Returning fewer than `k` results is penalised — this matches the standard IR convention. |
| `mean_latency_ms` | arithmetic mean of per-query `search + related` latency | Wall-clock, single-process, mock extractor. Treat as relative numbers; cross-machine comparisons need to control for hardware. |

Summary numbers in the report are the unweighted mean across all evaluated
questions and are rounded to four decimals.

## Dataset format

A dataset is a single JSON file:

```json
{
  "name": "synthetic",
  "sessions": [
    {
      "id": "s1",
      "messages": [
        { "role": "user", "content": "Person: Alice Chen, lead engineer at Acme." }
      ]
    }
  ],
  "questions": [
    {
      "id": "q1",
      "query": "alice chen",
      "expected_node_ids": ["alice-chen"]
    }
  ]
}
```

Constraints (enforced at load time by `BenchDatasetSchema`):

- At least one session and one question.
- Every session has at least one message; messages have `role`
  (`user` | `assistant` | `system`) and non-empty `content`.
- Every question has a non-empty `query` and at least one
  `expected_node_ids` entry.
- The `name` field is optional. If omitted, the loader uses the filename
  (without extension) as a fallback.

The synthetic fixture lives at
`packages/bench/fixtures/synthetic.json` and is co-designed with the mock
extractor — session text uses `Type: name, description` patterns that the
mock recognises, and each question's `expected_node_ids` are exactly the ids
the mock will emit. This lets the test suite assert non-trivial recall
deterministically.

## Plugging in a new dataset adapter

To add a new dataset (LongMemEval-shaped, LOCOMO-shaped, custom internal
data), write a thin adapter that converts the foreign format into the
`BenchDataset` shape above, and either:

- **Point `--dataset` at the converted JSON file**, or
- **Register a built-in name**: add the converter to `packages/bench/src/`,
  drop the JSON under `packages/bench/fixtures/<name>.json`, and add the
  name to `BUILTIN_DATASETS` in `packages/bench/src/dataset.ts`.

If the upstream dataset can't be redistributed (license, size), keep the
converter in the repo but generate the JSON outside the workspace and pass
the path with `--dataset`. The harness imposes no shape constraints beyond
the schema.

## Running against a real LLM

The mock extractor is deterministic and free, but it only finds entities
declared with explicit `Type: name` patterns. To evaluate Litopys against a
real extraction pipeline:

```bash
export ANTHROPIC_API_KEY=…
litopys bench --provider anthropic --dataset path/to/realistic.json
```

Expect significantly slower runs (each session triggers an LLM call) and
non-deterministic numbers across runs. Wrap repeat runs in
`--limit` for cost control and average over several invocations to get
stable estimates.
