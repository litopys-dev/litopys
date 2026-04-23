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
