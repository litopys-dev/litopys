import { describe, expect, test } from "bun:test";
import { MockAdapter } from "../src/adapters/mock.ts";

describe("adapter.complete", () => {
  test("mock returns queued completion and usage", async () => {
    const mock = new MockAdapter({ completions: ['{"groups":[]}'] });
    const out = await mock.complete({ prompt: "cluster these", maxTokens: 512 });
    expect(out.text).toBe('{"groups":[]}');
    expect(out.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });

  test("mock repeats last completion when queue is exhausted", async () => {
    const mock = new MockAdapter({ completions: ["first", "last"] });
    const out1 = await mock.complete({ prompt: "p1" });
    const out2 = await mock.complete({ prompt: "p2" });
    const out3 = await mock.complete({ prompt: "p3" });
    expect(out1.text).toBe("first");
    expect(out2.text).toBe("last");
    expect(out3.text).toBe("last");
  });

  test("mock completeCalls counter increments", async () => {
    const mock = new MockAdapter({ completions: ["x"] });
    expect(mock.completeCalls).toBe(0);
    await mock.complete({ prompt: "a" });
    await mock.complete({ prompt: "b" });
    expect(mock.completeCalls).toBe(2);
  });

  test("mock uses outputTokens equal to text length", async () => {
    const text = '{"groups":[]}';
    const mock = new MockAdapter({ completions: [text] });
    const out = await mock.complete({ prompt: "p" });
    expect(out.usage.outputTokens).toBe(text.length);
  });
});
