import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  builtinDatasetPath,
  isBuiltinDataset,
  loadDataset,
  loadDatasetFile,
  parseDataset,
  resolveDatasetSpec,
} from "../src/dataset.ts";

describe("parseDataset", () => {
  test("parses a minimal valid dataset", () => {
    const json = JSON.stringify({
      sessions: [{ id: "s1", messages: [{ role: "user", content: "hi" }] }],
      questions: [{ id: "q1", query: "hello", expected_node_ids: ["n1"] }],
    });
    const parsed = parseDataset(json, "fallback");
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.name).toBe("fallback");
  });

  test("preserves explicit dataset name over fallback", () => {
    const json = JSON.stringify({
      name: "explicit",
      sessions: [{ id: "s1", messages: [{ role: "user", content: "hi" }] }],
      questions: [{ id: "q1", query: "x", expected_node_ids: ["n1"] }],
    });
    expect(parseDataset(json, "fallback").name).toBe("explicit");
  });

  test("rejects empty sessions array", () => {
    const json = JSON.stringify({
      sessions: [],
      questions: [{ id: "q1", query: "x", expected_node_ids: ["n1"] }],
    });
    expect(() => parseDataset(json)).toThrow();
  });

  test("rejects empty questions array", () => {
    const json = JSON.stringify({
      sessions: [{ id: "s1", messages: [{ role: "user", content: "hi" }] }],
      questions: [],
    });
    expect(() => parseDataset(json)).toThrow();
  });

  test("rejects question without expected_node_ids", () => {
    const json = JSON.stringify({
      sessions: [{ id: "s1", messages: [{ role: "user", content: "hi" }] }],
      questions: [{ id: "q1", query: "x", expected_node_ids: [] }],
    });
    expect(() => parseDataset(json)).toThrow();
  });

  test("rejects session with empty messages", () => {
    const json = JSON.stringify({
      sessions: [{ id: "s1", messages: [] }],
      questions: [{ id: "q1", query: "x", expected_node_ids: ["n1"] }],
    });
    expect(() => parseDataset(json)).toThrow();
  });

  test("rejects invalid message role", () => {
    const json = JSON.stringify({
      sessions: [{ id: "s1", messages: [{ role: "robot", content: "hi" }] }],
      questions: [{ id: "q1", query: "x", expected_node_ids: ["n1"] }],
    });
    expect(() => parseDataset(json)).toThrow();
  });

  test("rejects malformed JSON", () => {
    expect(() => parseDataset("not json {")).toThrow();
  });
});

describe("loadDatasetFile", () => {
  test("loads a dataset from disk and derives name from filename", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bench-ds-"));
    const file = path.join(tmp, "my-dataset.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        sessions: [{ id: "s1", messages: [{ role: "user", content: "hi" }] }],
        questions: [{ id: "q1", query: "x", expected_node_ids: ["n1"] }],
      }),
    );
    const parsed = await loadDatasetFile(file);
    expect(parsed.name).toBe("my-dataset");
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("built-in synthetic dataset", () => {
  test("isBuiltinDataset identifies synthetic", () => {
    expect(isBuiltinDataset("synthetic")).toBe(true);
    expect(isBuiltinDataset("nope")).toBe(false);
  });

  test("builtinDatasetPath resolves to fixtures folder", () => {
    const p = builtinDatasetPath("synthetic");
    expect(p).toContain("packages/bench/fixtures/synthetic.json");
  });

  test("resolveDatasetSpec for built-in returns fixture path", () => {
    expect(resolveDatasetSpec("synthetic")).toContain("fixtures/synthetic.json");
  });

  test("resolveDatasetSpec for path returns absolute path", () => {
    const resolved = resolveDatasetSpec("./some/file.json");
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  test("loadDataset('synthetic') validates and returns the bundled fixture", async () => {
    const ds = await loadDataset("synthetic");
    expect(ds.name).toBe("synthetic");
    expect(ds.sessions.length).toBeGreaterThanOrEqual(5);
    expect(ds.questions.length).toBeGreaterThanOrEqual(10);
    // Every question must declare at least one expected id
    for (const q of ds.questions) {
      expect(q.expected_node_ids.length).toBeGreaterThan(0);
    }
  });
});
