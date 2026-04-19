/**
 * Bearer token auth for the HTTP transport.
 * stdio transport does not require auth.
 */

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/**
 * Check Authorization header against the expected bearer token.
 * Returns { ok: true } if auth passes, { ok: false, error } otherwise.
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
  if (token !== expectedToken) {
    return { ok: false, error: "Invalid bearer token" };
  }

  return { ok: true };
}

/**
 * Resolve the MCP token from environment. Returns the token string.
 * If not set, returns undefined (caller decides whether to fail).
 */
export function resolveToken(): string | undefined {
  return process.env.LITOPYS_MCP_TOKEN || undefined;
}
