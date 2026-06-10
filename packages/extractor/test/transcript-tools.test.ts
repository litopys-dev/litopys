import { describe, expect, test } from "bun:test";
import { parseClaudeCodeTranscript } from "../src/transcript-tools.ts";

const lines = [
  JSON.stringify({ type: "user", sessionId: "s1", message: { role: "user", content: "перезапусти syut" } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
    { type: "text", text: "Рестартую." },
    { type: "tool_use", id: "t1", name: "Bash", input: { command: "systemctl restart syut" } },
  ]}}),
  JSON.stringify({ type: "user", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 1: unit not found" },
  ]}}),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
    { type: "tool_use", id: "t2", name: "Bash", input: { command: "systemctl --user restart syut" } },
  ]}}),
  JSON.stringify({ type: "user", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "t2", content: "ok" },
  ]}}),
].join("\n");

describe("parseClaudeCodeTranscript", () => {
  test("tools mode keeps tool names, input gist and error flags", () => {
    const r = parseClaudeCodeTranscript(lines, { includeTools: "summary" });
    expect(r.text).toContain("USER: перезапусти syut");
    expect(r.text).toContain("TOOL: Bash(systemctl restart syut) → error");
    expect(r.text).toContain("TOOL: Bash(systemctl --user restart syut) → ok");
    expect(r.toolOps).toBe(2);
    expect(r.errorCount).toBe(1);
  });
  test("default mode drops tools (back-compat)", () => {
    const r = parseClaudeCodeTranscript(lines, {});
    expect(r.text).not.toContain("TOOL:");
  });
});
