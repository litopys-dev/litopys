import { describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { type SkillDetectorConfig, loadSkillConfig } from "../src/skill-config.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture everything written to process.stderr during the callback. */
async function captureStderr(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = originalWrite;
  }
  return chunks.join("");
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("loadSkillConfig — defaults", () => {
  test("returns all defaults when env is empty", () => {
    const cfg = loadSkillConfig({});
    expect(cfg.skillsDir).toBe(path.join(os.homedir(), ".claude", "skills"));
    expect(cfg.notifyCommand).toBeNull();
    expect(cfg.minToolOps).toBe(5);
    expect(cfg.minSessions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Overrides — each field individually
// ---------------------------------------------------------------------------

describe("loadSkillConfig — env overrides", () => {
  test("LITOPYS_SKILLS_DIR overrides skillsDir", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_DIR: "/custom/skills" });
    expect(cfg.skillsDir).toBe("/custom/skills");
  });

  test("LITOPYS_SKILLS_NOTIFY_CMD overrides notifyCommand", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_NOTIFY_CMD: "notify-send done" });
    expect(cfg.notifyCommand).toBe("notify-send done");
  });

  test("LITOPYS_SKILLS_MIN_TOOL_OPS overrides minToolOps", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_TOOL_OPS: "10" });
    expect(cfg.minToolOps).toBe(10);
  });

  test("LITOPYS_SKILLS_MIN_SESSIONS overrides minSessions", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_SESSIONS: "3" });
    expect(cfg.minSessions).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tilde expansion
// ---------------------------------------------------------------------------

describe("loadSkillConfig — tilde expansion", () => {
  test("~/... in LITOPYS_SKILLS_DIR is expanded to homedir", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_DIR: "~/.claude/skills" });
    expect(cfg.skillsDir).toBe(path.join(os.homedir(), ".claude", "skills"));
  });

  test("~/sub/dir in LITOPYS_SKILLS_DIR is expanded to homedir/sub/dir", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_DIR: "~/sub/dir" });
    expect(cfg.skillsDir).toBe(path.join(os.homedir(), "sub", "dir"));
  });
});

// ---------------------------------------------------------------------------
// Empty string for notifyCommand → null
// ---------------------------------------------------------------------------

describe("loadSkillConfig — empty notifyCommand", () => {
  test("empty string LITOPYS_SKILLS_NOTIFY_CMD → null", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_NOTIFY_CMD: "" });
    expect(cfg.notifyCommand).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invalid numbers — fallback to default + stderr warning
// ---------------------------------------------------------------------------

describe("loadSkillConfig — invalid minToolOps", () => {
  test("NaN string → default 5 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_TOOL_OPS: "abc" });
    });
    expect(cfg?.minToolOps).toBe(5);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_TOOL_OPS");
  });

  test("negative number → default 5 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_TOOL_OPS: "-3" });
    });
    expect(cfg?.minToolOps).toBe(5);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_TOOL_OPS");
  });

  test("zero → default 5 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_TOOL_OPS: "0" });
    });
    expect(cfg?.minToolOps).toBe(5);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_TOOL_OPS");
  });

  test("float string → default 5 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_TOOL_OPS: "3.5" });
    });
    expect(cfg?.minToolOps).toBe(5);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_TOOL_OPS");
  });
});

describe("loadSkillConfig — invalid minSessions", () => {
  test("NaN string → default 2 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_SESSIONS: "bad" });
    });
    expect(cfg?.minSessions).toBe(2);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_SESSIONS");
  });

  test("negative number → default 2 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_SESSIONS: "-1" });
    });
    expect(cfg?.minSessions).toBe(2);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_SESSIONS");
  });

  test("zero → default 2 + warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_SESSIONS: "0" });
    });
    expect(cfg?.minSessions).toBe(2);
    expect(stderr).toContain("[litopys/skills]");
    expect(stderr).toContain("LITOPYS_SKILLS_MIN_SESSIONS");
  });
});

// ---------------------------------------------------------------------------
// Empty string for numeric env vars → treated as unset (no warning)
// ---------------------------------------------------------------------------

describe("loadSkillConfig — empty string numeric env vars", () => {
  test("LITOPYS_SKILLS_DIR: '~' → expands to os.homedir()", () => {
    const cfg = loadSkillConfig({ LITOPYS_SKILLS_DIR: "~" });
    expect(cfg.skillsDir).toBe(os.homedir());
  });

  test("empty string LITOPYS_SKILLS_MIN_TOOL_OPS → uses default without warning", async () => {
    let cfg: SkillDetectorConfig | undefined;
    const stderr = await captureStderr(() => {
      cfg = loadSkillConfig({ LITOPYS_SKILLS_MIN_TOOL_OPS: "" });
    });
    expect(cfg?.minToolOps).toBe(5);
    expect(stderr).not.toContain("LITOPYS_SKILLS_MIN_TOOL_OPS");
  });
});

// ---------------------------------------------------------------------------
// All overrides together
// ---------------------------------------------------------------------------

describe("loadSkillConfig — full override", () => {
  test("all env vars set → all fields overridden", () => {
    const cfg = loadSkillConfig({
      LITOPYS_SKILLS_DIR: "/opt/skills",
      LITOPYS_SKILLS_NOTIFY_CMD: "echo promoted",
      LITOPYS_SKILLS_MIN_TOOL_OPS: "8",
      LITOPYS_SKILLS_MIN_SESSIONS: "4",
    });
    expect(cfg.skillsDir).toBe("/opt/skills");
    expect(cfg.notifyCommand).toBe("echo promoted");
    expect(cfg.minToolOps).toBe(8);
    expect(cfg.minSessions).toBe(4);
  });
});
