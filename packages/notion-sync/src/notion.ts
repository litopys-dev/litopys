// Notion REST API v1 client — minimal, no SDK dependency

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotionPage {
  id: string;
  object: "page";
  url: string;
  last_edited_time: string;
  created_time: string;
  properties: Record<string, unknown>;
  parent: unknown;
}

interface SearchResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface BlockResponse {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

interface RichText {
  plain_text: string;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Block → text
// ---------------------------------------------------------------------------

function richTextToString(rich_text: RichText[]): string {
  return rich_text.map((rt) => rt.plain_text).join("");
}

function blockToText(block: NotionBlock): string {
  const type = block.type;
  const content = (block as Record<string, unknown>)[type] as Record<string, unknown> | undefined;
  if (!content) return "";

  const rt = content.rich_text;
  const text = Array.isArray(rt) ? richTextToString(rt as RichText[]) : "";

  switch (type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do": {
      const checked = content.checked as boolean | undefined;
      return `- [${checked ? "x" : " "}] ${text}`;
    }
    case "quote":
      return `> ${text}`;
    case "callout":
      return `> ${text}`;
    case "code":
      return `\`\`\`\n${text}\n\`\`\``;
    case "paragraph":
      return text;
    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    const p = prop as Record<string, unknown>;
    if (p.type === "title" && Array.isArray(p.title)) {
      return (p.title as RichText[]).map((rt) => rt.plain_text).join("");
    }
  }
  return `(untitled ${page.id.slice(0, 8)})`;
}

export async function getPageText(token: string, pageId: string, depth = 0): Promise<string> {
  if (depth > 3) return "";

  const res = await fetch(`${NOTION_API}/blocks/${pageId}/children?page_size=100`, {
    headers: headers(token),
  });

  if (!res.ok) {
    process.stderr.write(`[notion-sync] blocks fetch failed: ${res.status} for ${pageId}\n`);
    return "";
  }

  const data = (await res.json()) as BlockResponse;
  const lines: string[] = [];

  for (const block of data.results) {
    const text = blockToText(block);
    if (text) lines.push(text);

    if (block.has_children) {
      const childText = await getPageText(token, block.id, depth + 1);
      if (childText) lines.push(childText);
    }
  }

  return lines.join("\n");
}

export async function searchRecentPages(token: string, since: Date): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;

  while (true) {
    const body: Record<string, unknown> = {
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`${NOTION_API}/search`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      process.stderr.write(`[notion-sync] search failed: ${res.status}\n`);
      break;
    }

    const data = (await res.json()) as SearchResponse;

    for (const result of data.results) {
      if (result.object !== "page") continue;
      const editedAt = new Date(result.last_edited_time);
      // Results sorted descending — stop when we reach older than `since`
      if (editedAt <= since) return pages;
      pages.push(result);
    }

    if (!data.has_more) break;
    cursor = data.next_cursor;
  }

  return pages;
}
