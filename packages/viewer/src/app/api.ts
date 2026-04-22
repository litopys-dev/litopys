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
}

export interface QuarantineFile {
  filePath: string;
  meta: { sessionId: string; timestamp: string; adapterName: string };
  candidateCount: number;
  relationCount: number;
  candidates: QuarantineCandidate[];
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  createNode: (input: CreateNodeInput) => send<{ node: AnyNodeRaw }>("/api/node", "POST", input),
  updateNode: (id: string, input: UpdateNodeInput) =>
    send<{ node: AnyNodeRaw }>(`/api/node/${encodeURIComponent(id)}`, "PUT", input),
  deleteNode: (id: string) => send<void>(`/api/node/${encodeURIComponent(id)}`, "DELETE"),
  addRelation: (id: string, input: RelationInput) =>
    send<{ node: AnyNodeRaw }>(`/api/node/${encodeURIComponent(id)}/relation`, "POST", input),
  removeRelation: (id: string, input: RelationInput) =>
    send<{ node: AnyNodeRaw }>(`/api/node/${encodeURIComponent(id)}/relation`, "DELETE", input),
};
