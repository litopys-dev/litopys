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

export const api = {
  stats: () => get<StatsResponse>("/api/stats"),
  nodes: () => get<NodeRow[]>("/api/nodes"),
  node: (id: string) => get<NodeDetailResponse>(`/api/node/${encodeURIComponent(id)}`),
  quarantine: () => get<QuarantineFile[]>("/api/quarantine"),
};
