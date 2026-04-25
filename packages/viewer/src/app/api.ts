// ---------------------------------------------------------------------------
// API client — typed wrappers around /api/* endpoints
// ---------------------------------------------------------------------------

export type NodeType = "person" | "project" | "system" | "concept" | "event" | "lesson";
export type RelationName =
  | "owns"
  | "prefers"
  | "learned_from"
  | "uses"
  | "applies_to"
  | "conflicts_with"
  | "runs_on"
  | "depends_on"
  | "reinforces"
  | "mentioned_in"
  | "supersedes";

export interface NodeRow {
  id: string;
  type: NodeType;
  summary: string;
  tags: string[];
  updated: string;
  confidence: number;
}

export interface StatsResponse {
  nodeCount: number;
  edgeCount: number;
  typeBreakdown: Partial<Record<NodeType, number>>;
}

export interface EdgeData {
  from: string;
  to: string;
  relation: RelationName;
  symmetric: boolean;
}

export interface AnyNodeRaw {
  id: string;
  type: NodeType;
  summary?: string;
  body?: string;
  updated: string;
  confidence: number;
  tags?: string[];
  aliases?: string[];
  rels?: Partial<Record<RelationName, string[]>>;
  [key: string]: unknown;
}

export interface NodeDetailResponse {
  node: AnyNodeRaw;
  incoming: EdgeData[];
  outgoing: EdgeData[];
}

export interface GraphNodeElement {
  data: { id: string; label: string; type: NodeType; summary: string };
}

export interface GraphEdgeElement {
  data: {
    id: string;
    source: string;
    target: string;
    relation: RelationName;
    symmetric: boolean;
  };
}

export interface GraphResponse {
  nodes: GraphNodeElement[];
  edges: GraphEdgeElement[];
}

export interface QuarantineCandidate {
  id: string;
  type: NodeType;
  summary: string;
  confidence: number;
  reasoning: string;
}

export interface QuarantineRelation {
  sourceId: string;
  type: RelationName;
  targetId: string;
}

export interface QuarantineRegularFile {
  kind: "regular";
  filePath: string;
  meta: { sessionId: string; timestamp: string; adapterName: string };
  candidateCount: number;
  relationCount: number;
  candidates: QuarantineCandidate[];
  relations: QuarantineRelation[];
}

export interface MergeResultPayload {
  id: string;
  type: NodeType;
  aliases: string[];
  summary?: string;
  tags: string[];
  rels: Partial<Record<RelationName, string[]>>;
  body?: string;
  confidence: number;
  winnerId: string;
  loserId: string;
}

export interface MergeConflictPayload {
  field: "summary" | "body" | "type" | "rels";
  detail: string;
}

export interface MergeProposalPayload {
  kind: "merge-proposal";
  sourceA: string;
  sourceB: string;
  result: MergeResultPayload;
  conflicts: MergeConflictPayload[];
  detectedBy: string;
}

export interface QuarantineMergeFile {
  kind: "merge";
  filePath: string;
  proposal: MergeProposalPayload;
}

export type QuarantineFile = QuarantineRegularFile | QuarantineMergeFile;

/**
 * Bearer token for mutating viewer requests. The dashboard reads this from
 * either a `?token=...` query param (set once, then cached in localStorage)
 * or from the LITOPYS_VIEWER_TOKEN value the user pastes via the prompt the
 * first time a write fails with 401. Read-only requests don't need it.
 */
const TOKEN_KEY = "litopys.viewer.token";

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  // First-time bootstrap from URL query
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    window.localStorage.setItem(TOKEN_KEY, fromUrl);
    params.delete("token");
    const cleaned = params.toString();
    const url = `${window.location.pathname}${cleaned ? `?${cleaned}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", url);
    return fromUrl;
  }
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

function promptForToken(): string {
  if (typeof window === "undefined") return "";
  const supplied = window.prompt(
    "This viewer requires LITOPYS_VIEWER_TOKEN for writes. Paste the token:",
    "",
  );
  const token = (supplied ?? "").trim();
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  return token;
}

function authHeaders(): Record<string, string> {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 401 — token missing or wrong. Prompt the user once, retry once.
  if (res.status === 401) {
    const fresh = promptForToken();
    if (fresh) {
      res = await fetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${fresh}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload?.error) msg = payload.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface CreateNodeInput {
  id: string;
  type: NodeType;
  summary?: string;
  body?: string;
  tags?: string[];
  aliases?: string[];
  confidence?: number;
}

export interface UpdateNodeInput {
  summary?: string | null;
  body?: string | null;
  tags?: string[];
  aliases?: string[];
  confidence?: number;
}

export interface RelationInput {
  relation: RelationName;
  target: string;
}

export const api = {
  stats: () => get<StatsResponse>("/api/stats"),
  nodes: () => get<NodeRow[]>("/api/nodes"),
  node: (id: string) => get<NodeDetailResponse>(`/api/node/${encodeURIComponent(id)}`),
  graph: () => get<GraphResponse>("/api/graph"),
  quarantine: () => get<QuarantineFile[]>("/api/quarantine"),
  acceptQuarantine: (filePath: string, index?: number) =>
    send<{ ok: boolean; result?: unknown }>("/api/quarantine/accept", "POST", {
      filePath,
      ...(index !== undefined ? { index } : {}),
    }),
  rejectQuarantine: (filePath: string, index?: number, reason?: string) =>
    send<{ ok: boolean }>("/api/quarantine/reject", "POST", {
      filePath,
      ...(index !== undefined ? { index } : {}),
      ...(reason ? { reason } : {}),
    }),
  createNode: (input: CreateNodeInput) => send<{ node: AnyNodeRaw }>("/api/node", "POST", input),
  updateNode: (id: string, input: UpdateNodeInput) =>
    send<{ node: AnyNodeRaw }>(`/api/node/${encodeURIComponent(id)}`, "PUT", input),
  deleteNode: (id: string) => send<void>(`/api/node/${encodeURIComponent(id)}`, "DELETE"),
  addRelation: (id: string, input: RelationInput) =>
    send<{ node: AnyNodeRaw }>(`/api/node/${encodeURIComponent(id)}/relation`, "POST", input),
  removeRelation: (id: string, input: RelationInput) =>
    send<{ node: AnyNodeRaw }>(`/api/node/${encodeURIComponent(id)}/relation`, "DELETE", input),
};
