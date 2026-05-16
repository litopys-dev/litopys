import { describe, expect, test } from "bun:test";
import {
  type AnyNode,
  BaseNodeSchema,
  eventDateFromId,
  isIsoDate,
  isValidAsOf,
  resolveOccurredAt,
} from "../src/index.ts";

function mkNode(partial: Partial<AnyNode> & { id: string; type?: AnyNode["type"] }): AnyNode {
  return {
    type: "concept",
    updated: "2026-01-01",
    confidence: 1,
    ...partial,
  } as AnyNode;
}

describe("BaseNodeSchema: bi-temporal fields", () => {
  test("accepts occurred_at as ISO date", () => {
    const r = BaseNodeSchema.safeParse({
      id: "x",
      type: "event",
      updated: "2026-04-19",
      confidence: 1,
      occurred_at: "2026-04-01",
    });
    expect(r.success).toBe(true);
  });

  test("rejects occurred_at in wrong format", () => {
    const r = BaseNodeSchema.safeParse({
      id: "x",
      type: "event",
      updated: "2026-04-19",
      confidence: 1,
      occurred_at: "04/01/2026",
    });
    expect(r.success).toBe(false);
  });

  test("accepts since and until together", () => {
    const r = BaseNodeSchema.safeParse({
      id: "x",
      type: "system",
      updated: "2026-04-19",
      confidence: 1,
      since: "2026-01-01",
      until: "2026-06-01",
    });
    expect(r.success).toBe(true);
  });

  test("treats occurred_at as optional (backward compatibility)", () => {
    const r = BaseNodeSchema.safeParse({
      id: "x",
      type: "person",
      updated: "2026-04-19",
      confidence: 1,
    });
    expect(r.success).toBe(true);
  });
});

describe("isIsoDate", () => {
  test("accepts valid ISO date", () => {
    expect(isIsoDate("2026-04-19")).toBe(true);
  });
  test("rejects bad format", () => {
    expect(isIsoDate("19-04-2026")).toBe(false);
    expect(isIsoDate("2026/04/19")).toBe(false);
  });
});

describe("eventDateFromId", () => {
  test("extracts date prefix from event id", () => {
    expect(eventDateFromId("2026-04-22-incident")).toBe("2026-04-22");
  });
  test("returns undefined when no prefix", () => {
    expect(eventDateFromId("alpha-project")).toBeUndefined();
  });
  test("returns date even for bare-date id", () => {
    expect(eventDateFromId("2026-04-22")).toBe("2026-04-22");
  });
});

describe("resolveOccurredAt fallback chain", () => {
  test("uses occurred_at when set", () => {
    const n = mkNode({ id: "x", occurred_at: "2026-03-01", since: "2026-02-01" });
    expect(resolveOccurredAt(n)).toBe("2026-03-01");
  });

  test("falls back to since when occurred_at missing", () => {
    const n = mkNode({ id: "x", since: "2026-02-01" });
    expect(resolveOccurredAt(n)).toBe("2026-02-01");
  });

  test("uses id-prefix for event nodes", () => {
    const n = mkNode({ id: "2026-04-22-incident", type: "event" });
    expect(resolveOccurredAt(n)).toBe("2026-04-22");
  });

  test("falls back to updated as last resort", () => {
    const n = mkNode({ id: "x", updated: "2026-01-01" });
    expect(resolveOccurredAt(n)).toBe("2026-01-01");
  });
});

describe("isValidAsOf", () => {
  test("node without since/until is always valid", () => {
    const n = mkNode({ id: "x" });
    expect(isValidAsOf(n, "2026-04-19")).toBe(true);
    expect(isValidAsOf(n, "1999-01-01")).toBe(true);
  });

  test("node before since is not yet valid", () => {
    const n = mkNode({ id: "x", since: "2026-03-01" });
    expect(isValidAsOf(n, "2026-02-15")).toBe(false);
    expect(isValidAsOf(n, "2026-03-01")).toBe(true);
    expect(isValidAsOf(n, "2026-04-01")).toBe(true);
  });

  test("node at or after until is not valid (half-open interval)", () => {
    const n = mkNode({ id: "x", since: "2026-01-01", until: "2026-04-01" });
    expect(isValidAsOf(n, "2026-03-31")).toBe(true);
    expect(isValidAsOf(n, "2026-04-01")).toBe(false);
    expect(isValidAsOf(n, "2026-05-01")).toBe(false);
  });

  test("throws on invalid as_of format", () => {
    const n = mkNode({ id: "x" });
    expect(() => isValidAsOf(n, "not-a-date")).toThrow();
  });
});
