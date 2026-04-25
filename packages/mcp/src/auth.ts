/**
 * Bearer token auth for the HTTP transport.
 * stdio transport does not require auth.
 */

import { timingSafeEqual } from "node:crypto";

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/**
 * Check Authorization header against the expected bearer token.
 * Returns { ok: true } if auth passes, { ok: false, error } otherwise.
 *
 * Token comparison is constant-time — see [bytes-leak the token under HTTP transport
 * remote use] in the security audit. A naïve `===` short-circuits on the first
 * mismatching byte, leaking the token byte by byte to a network attacker.
 */
export function checkBearer(authHeader: string | undefined, expectedToken: string): AuthResult {
  if (!authHeader) {
    return { ok: false, error: "Missing Authorization header" };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    return { ok: false, error: "Invalid Authorization header format (expected: Bearer <token>)" };
  }

  const token = parts[1] ?? "";
  if (!constantTimeEqual(token, expectedToken)) {
    return { ok: false, error: "Invalid bearer token" };
  }

  return { ok: true };
}

/**
 * Constant-time string equality. Length is intentionally checked before the
 * timingSafeEqual call — comparing buffers of unequal length is impossible
 * without leaking the length, and the length itself is not a secret.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Resolve the MCP token from environment. Returns the token string.
 * If not set, returns undefined (caller decides whether to fail).
 */
export function resolveToken(): string | undefined {
  return process.env.LITOPYS_MCP_TOKEN || undefined;
}
