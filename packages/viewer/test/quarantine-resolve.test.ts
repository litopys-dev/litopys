import { describe, expect, test } from "bun:test";
import {
  type RawRelation,
  type RefSource,
  resolveRef,
  resolveRelation,
} from "../src/quarantine-resolve.ts";

const candidates = new Map<string, RefSource>([
  ["litopys-extractor", { type: "system", summary: "Extractor subsystem" }],
]);
const graphNodes = new Map<string, RefSource>([
  ["litopys", { type: "project", summary: "Graph memory project" }],
  ["denis", { type: "person", summary: "Owner" }],
]);

describe("resolveRef", () => {
  test("id matching a candidate is 'new' with candidate type/summary", () => {
    expect(resolveRef("litopys-extractor", candidates, graphNodes)).toEqual({
      id: "litopys-extractor",
      origin: "new",
      type: "system",
      summary: "Extractor subsystem",
    });
  });

  test("id matching a graph node is 'existing' with node type/summary", () => {
    expect(resolveRef("litopys", candidates, graphNodes)).toEqual({
      id: "litopys",
      origin: "existing",
      type: "project",
      summary: "Graph memory project",
    });
  });

  test("id matching neither is 'unknown' with no type/summary", () => {
    expect(resolveRef("ghost-node", candidates, graphNodes)).toEqual({
      id: "ghost-node",
      origin: "unknown",
    });
  });

  test("candidate takes precedence over a same-id graph node", () => {
    const cands = new Map<string, RefSource>([["litopys", { type: "concept" }]]);
    expect(resolveRef("litopys", cands, graphNodes).origin).toBe("new");
    expect(resolveRef("litopys", cands, graphNodes).type).toBe("concept");
  });
});

describe("resolveRelation", () => {
  test("resolves both endpoints and carries confidence/reasoning through", () => {
    const rel: RawRelation = {
      type: "applies_to",
      sourceId: "litopys-extractor",
      targetId: "litopys",
      confidence: 0.83,
      reasoning: "extractor feeds the project graph",
    };
    expect(resolveRelation(rel, candidates, graphNodes)).toEqual({
      type: "applies_to",
      source: { id: "litopys-extractor", origin: "new", type: "system", summary: "Extractor subsystem" },
      target: { id: "litopys", origin: "existing", type: "project", summary: "Graph memory project" },
      confidence: 0.83,
      reasoning: "extractor feeds the project graph",
    });
  });

  test("dangling endpoints resolve to 'unknown'", () => {
    const rel: RawRelation = { type: "owns", sourceId: "nobody", targetId: "nothing" };
    const out = resolveRelation(rel, candidates, graphNodes);
    expect(out.source.origin).toBe("unknown");
    expect(out.target.origin).toBe("unknown");
  });
});
