import { describe, expect, test } from "bun:test";
import { parseClaudeCodeTranscript, sessionDateFromTranscript } from "../src/transcript-tools.ts";

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
    const r = parseClaudeCodeTranscript(lines);
    expect(r.text).not.toContain("TOOL:");
  });

  test("sessionId is captured from first event that has it", () => {
    const r = parseClaudeCodeTranscript(lines, { includeTools: "summary" });
    expect(r.sessionId).toBe("s1");
  });

  test("string content starting with Exit code N counts as error without is_error", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "false" } },
      ]}}),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: "Exit code 2: command failed" },
      ]}}),
    ].join("\n");
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.errorCount).toBe(1);
    expect(r.text).toContain("TOOL: Bash(false) → error");
  });

  test("nested-array tool_result content detects error from text sub-block", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "broken" } },
      ]}}),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: [
          { type: "text", text: "Error: something went wrong" },
        ]},
      ]}}),
    ].join("\n");
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.errorCount).toBe(1);
    expect(r.text).toContain("TOOL: Bash(broken) → error");
  });

  test("pending tool_use without tool_result is counted but emits no TOOL: line", () => {
    const raw = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "t9", name: "Bash", input: { command: "sleep 999" } },
    ]}});
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.toolOps).toBe(1);
    expect(r.errorCount).toBe(0);
    expect(r.text).not.toContain("TOOL:");
  });

  test("broken/partial JSON lines are skipped without throwing", () => {
    const raw = [
      JSON.stringify({ type: "user", sessionId: "s2", message: { role: "user", content: "привет" } }),
      '{"type": "assistant", "message": {"role": "assi',
      "not json at all",
    ].join("\n");
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.text).toBe("USER: привет");
    expect(r.sessionId).toBe("s2");
  });

  test("gist truncates long Bash command at 80 chars", () => {
    const longCmd = "echo " + "x".repeat(200);
    const raw = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: longCmd } },
      ]}}),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: "ok" },
      ]}}),
    ].join("\n");
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.text).toContain(`TOOL: Bash(${longCmd.slice(0, 80)}) → ok`);
    expect(r.text).not.toContain(longCmd.slice(0, 81));
  });

  test("gist uses file_path for Read/Edit/Write tools", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/etc/nginx/nginx.conf" } },
      ]}}),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: "server {}" },
      ]}}),
    ].join("\n");
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.text).toContain("TOOL: Read(/etc/nginx/nginx.conf) → ok");
  });

  test("gist collapses multi-line command into one line", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "git add .\n  git commit -m 'x'" } },
      ]}}),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: "ok" },
      ]}}),
    ].join("\n");
    const r = parseClaudeCodeTranscript(raw, { includeTools: "summary" });
    expect(r.text).toContain("TOOL: Bash(git add . git commit -m 'x') → ok");
  });
});

// ---------------------------------------------------------------------------
// sessionDateFromTranscript
// ---------------------------------------------------------------------------

describe("sessionDateFromTranscript", () => {
  test("returns YYYY-MM-DD from first event with a parseable timestamp", () => {
    const raw = [
      JSON.stringify({ type: "permission-mode", sessionId: "s1" }),
      JSON.stringify({ type: "user", sessionId: "s1", timestamp: "2026-03-15T10:00:00.000Z", message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "assistant", sessionId: "s1", timestamp: "2026-03-15T10:01:00.000Z", message: { role: "assistant", content: "hi" } }),
    ].join("\n");

    const date = sessionDateFromTranscript(raw);
    expect(date).toBe("2026-03-15");
  });

  test("skips events without timestamp, uses first one that has it", () => {
    const raw = [
      JSON.stringify({ type: "last-prompt", sessionId: "s1" }),
      JSON.stringify({ type: "permission-mode", sessionId: "s1" }),
      JSON.stringify({ type: "user", sessionId: "s1", timestamp: "2026-06-10T08:30:00.000Z" }),
    ].join("\n");

    const date = sessionDateFromTranscript(raw);
    expect(date).toBe("2026-06-10");
  });

  test("returns undefined when no event has a timestamp", () => {
    const raw = [
      JSON.stringify({ type: "permission-mode", sessionId: "s1" }),
      JSON.stringify({ type: "user", sessionId: "s1", message: { role: "user", content: "hi" } }),
    ].join("\n");

    const date = sessionDateFromTranscript(raw);
    expect(date).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(sessionDateFromTranscript("")).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", () => {
    expect(sessionDateFromTranscript("   \n\t  ")).toBeUndefined();
  });

  test("skips events with non-string timestamp field", () => {
    const raw = [
      JSON.stringify({ type: "user", timestamp: 1234567890, message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "user", timestamp: "2026-04-01T12:00:00.000Z" }),
    ].join("\n");

    const date = sessionDateFromTranscript(raw);
    expect(date).toBe("2026-04-01");
  });

  test("skips events with invalid/non-parseable timestamp string", () => {
    const raw = [
      JSON.stringify({ type: "user", timestamp: "not-a-date", message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "user", timestamp: "2026-05-20T00:00:00.000Z" }),
    ].join("\n");

    const date = sessionDateFromTranscript(raw);
    expect(date).toBe("2026-05-20");
  });

  test("broken JSON lines are skipped", () => {
    const raw = [
      '{"type":"user","timestamp":',
      JSON.stringify({ type: "user", timestamp: "2026-07-04T15:00:00.000Z" }),
    ].join("\n");

    const date = sessionDateFromTranscript(raw);
    expect(date).toBe("2026-07-04");
  });

  test("non-ISO but Date-parseable timestamp (06/10/2026) is rejected → undefined", () => {
    const raw = JSON.stringify({
      type: "user",
      timestamp: "06/10/2026",
      message: { role: "user", content: "hi" },
    });

    expect(sessionDateFromTranscript(raw)).toBeUndefined();
  });

  test("non-ISO timestamps are skipped in favour of a later ISO one", () => {
    const raw = [
      JSON.stringify({ type: "user", timestamp: "06/10/2026" }),
      JSON.stringify({ type: "user", timestamp: "Mon, 26 May 2026 05:58:16 GMT" }),
      JSON.stringify({ type: "user", timestamp: "2026-05-26T05:58:16.581Z" }),
    ].join("\n");

    expect(sessionDateFromTranscript(raw)).toBe("2026-05-26");
  });

  test("ISO-prefixed but impossible calendar date (2026-13-45) is rejected", () => {
    const raw = JSON.stringify({ type: "user", timestamp: "2026-13-45T00:00:00.000Z" });
    expect(sessionDateFromTranscript(raw)).toBeUndefined();
  });
});
