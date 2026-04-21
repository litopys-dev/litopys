import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cmdSimilar, parseSimilarArgs } from "../src/similar.ts";

// ---------------------------------------------------------------------------
// parseSimilarArgs
// ---------------------------------------------------------------------------

describe("parseSimilarArgs", () => {
  test("parses bare id", () => {
    const { id, opts } = parseSimilarArgs(["alice"]);
    expect(id).toBe("alice");
    expect(opts.explain).toBe(false);
    expect(opts.limit).toBe(10);
    expect(opts.minScore).toBeCloseTo(0.35, 5);
  });

  test("parses --explain", () => {
    const { opts } = parseSimilarArgs(["alice", "--explain"]);
    expect(opts.explain).toBe(true);
  });

  test("parses --limit and --min-score", () => {
    const { opts } = parseSimilarArgs(["x", "--limit", "3", "--min-score", "0.8"]);
    expect(opts.limit).toBe(3);
    expect(opts.minScore).toBeCloseTo(0.8, 5);
  });

  test("rejects unknown flag", () => {
    expect(() => parseSimilarArgs(["x", "--nonsense"])).toThrow();
  });

  test("rejects missing id", () => {
    expect(() => parseSimilarArgs([])).toThrow();
  });

  test("rejects invalid --limit", () => {
    expect(() => parseSimilarArgs(["x", "--limit", "zero"])).toThrow();
  });

  test("rejects invalid --min-score", () => {
    expect(() => parseSimilarArgs(["x", "--min-score", "5"])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// cmdSimilar (integration against a tiny fake graph)
// ---------------------------------------------------------------------------

async function writeNodeFile(dir: string, id: string, frontmatter: string): Promise<void> {
  const file = path.join(dir, `${id}.md`);
  await fs.writeFile(file, `---\n${frontmatter}---\n\nbody\n`, "utf-8");
}

describe("cmdSimilar — integration", () => {
  test("prints merge candidates from a tiny graph", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "litopys-similar-"));
    await writeNodeFile(
      tmp,
      "thinkpad-x240",
      `id: thinkpad-x240
type: system
summary: ThinkPad X240 laptop
updated: "2026-04-21"
confidence: 1
tags: [laptop]
`,
    );
    await writeNodeFile(
      tmp,
      "lenovo-x240",
      `id: lenovo-x240
type: system
summary: Lenovo X240
updated: "2026-04-21"
confidence: 1
aliases: [thinkpad-x240]
tags: [laptop]
`,
    );
    await writeNodeFile(
      tmp,
      "unrelated",
      `id: unrelated
type: concept
summary: unrelated concept
updated: "2026-04-21"
confidence: 1
`,
    );

    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : new TextDecoder().decode(s));
      return true;
    }) as typeof process.stdout.write;

    try {
      await cmdSimilar(["thinkpad-x240"], tmp);
    } finally {
      process.stdout.write = orig;
      await fs.rm(tmp, { recursive: true, force: true });
    }

    const output = chunks.join("");
    expect(output).toContain("Merge candidates");
    expect(output).toContain("lenovo-x240");
  });
});
