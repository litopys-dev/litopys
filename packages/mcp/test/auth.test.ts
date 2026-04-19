import { describe, expect, test } from "bun:test";
import { checkBearer } from "../src/auth.ts";

describe("checkBearer", () => {
  test("returns ok=true for valid token", () => {
    const result = checkBearer("Bearer secret123", "secret123");
    expect(result.ok).toBe(true);
  });

  test("returns ok=false for missing Authorization header", () => {
    const result = checkBearer(undefined, "secret123");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("returns ok=false for wrong token", () => {
    const result = checkBearer("Bearer wrongtoken", "secret123");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("returns ok=false for empty token", () => {
    const result = checkBearer("Bearer ", "secret123");
    expect(result.ok).toBe(false);
  });

  test("returns ok=false for malformed header (no Bearer prefix)", () => {
    const result = checkBearer("Token secret123", "secret123");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Bearer");
  });

  test("returns ok=false for header with only scheme", () => {
    const result = checkBearer("Bearer", "secret123");
    expect(result.ok).toBe(false);
  });

  test("is case-insensitive for 'bearer' keyword", () => {
    const result = checkBearer("bearer secret123", "secret123");
    expect(result.ok).toBe(true);
  });

  test("is case-sensitive for token value", () => {
    const result = checkBearer("Bearer Secret123", "secret123");
    expect(result.ok).toBe(false);
  });

  test("works with complex token strings", () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def";
    const result = checkBearer(`Bearer ${token}`, token);
    expect(result.ok).toBe(true);
  });

  test("returns ok=false for empty authorization header string", () => {
    const result = checkBearer("", "secret123");
    expect(result.ok).toBe(false);
  });
});
