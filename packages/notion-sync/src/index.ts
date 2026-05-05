#!/usr/bin/env bun
/**
 * Litopys Notion Sync — reads recently changed Notion pages,
 * extracts knowledge candidates via Ollama, writes to quarantine.
 *
 * Runs as a systemd timer every 6 hours.
 * State (lastSync timestamp) stored in LITOPYS_GRAPH_PATH/../notion-sync.json
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defaultGraphPath, loadGraph } from "@litopys/core";
import { createAdapter, writeQuarantine } from "@litopys/extractor";
import { getPageText, getPageTitle, searchRecentPages } from "./notion.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATE_FILE_NAME = "notion-sync.json";
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h on first run

interface SyncState {
  lastSync: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function stateFilePath(graphPath: string): string {
  return path.join(graphPath, "..", STATE_FILE_NAME);
}

async function readState(graphPath: string): Promise<Date> {
  try {
    const raw = await fs.readFile(stateFilePath(graphPath), "utf-8");
    const state = JSON.parse(raw) as SyncState;
    return new Date(state.lastSync);
  } catch {
    // First run — look back 24h
    return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  }
}

async function writeState(graphPath: string, timestamp: Date): Promise<void> {
  const state: SyncState = { lastSync: timestamp.toISOString() };
  await fs.writeFile(stateFilePath(graphPath), JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  // Load NOTION_TOKEN from env or ~/litopys/.env
  let token = process.env.NOTION_TOKEN;
  if (!token) {
    const envFile = path.join(import.meta.dir, "..", "..", "..", ".env");
    try {
      const raw = await fs.readFile(envFile, "utf-8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^NOTION_TOKEN\s*=\s*(.+)$/);
        if (m?.[1]) {
          token = m[1].trim().replace(/^["']|["']$/g, "");
          break;
        }
      }
    } catch {
      // no .env file
    }
  }

  if (!token) {
    process.stderr.write("[notion-sync] NOTION_TOKEN not set — aborting\n");
    process.exit(1);
  }

  const graphPath = defaultGraphPath();
  const since = await readState(graphPath);
  const syncStart = new Date();

  process.stderr.write(`[notion-sync] Searching for pages edited after ${since.toISOString()}\n`);

  const rawPages = await searchRecentPages(token, since);

  if (rawPages.length === 0) {
    process.stderr.write("[notion-sync] No new pages — nothing to sync\n");
    await writeState(graphPath, syncStart);
    return;
  }

  process.stderr.write(`[notion-sync] Found ${rawPages.length} page(s) — fetching content\n`);

  // Fetch page text
  const pages: Array<{ id: string; title: string; editedAt: string; text: string }> = [];
  for (const page of rawPages) {
    const title = getPageTitle(page);
    const text = await getPageText(token, page.id);
    pages.push({ id: page.id, title, editedAt: page.last_edited_time, text });
    process.stderr.write(`[notion-sync]   "${title}" — ${text.length} chars\n`);
  }

  // Load existing node ids for dedup
  let existingNodeIds: string[] = [];
  try {
    const loaded = await loadGraph(graphPath);
    existingNodeIds = Array.from(loaded.nodes.keys());
  } catch {
    // empty graph
  }

  const provider = process.env.LITOPYS_EXTRACTOR_PROVIDER ?? "ollama";
  const adapter = createAdapter(provider);

  process.stderr.write(`[notion-sync] Extracting with ${adapter.name} (${adapter.model})\n`);

  // Process each page individually — smaller context, avoids Ollama timeout
  let totalNodes = 0;
  let totalRelations = 0;
  let lastFile = "";

  for (const page of pages) {
    if (!page.text) continue;

    const transcript = `Notion page: "${page.title}" (last edited: ${page.editedAt})\n\n${page.text}`;
    const sessionId = `notion-sync-${page.id.slice(0, 8)}-${syncStart.toISOString().replace(/[:.]/g, "-")}`;

    process.stderr.write(`[notion-sync] Processing "${page.title}"\n`);

    const output = await adapter.extract({
      transcript,
      existingNodeIds,
      maxCandidates: 8,
    });

    if (output.candidateNodes.length === 0) continue;

    lastFile = await writeQuarantine(output.candidateNodes, output.candidateRelations, {
      sessionId,
      timestamp: syncStart.toISOString(),
      adapterName: adapter.name,
    });

    // Add newly extracted ids so next page doesn't duplicate them
    for (const n of output.candidateNodes) existingNodeIds.push(n.id);

    totalNodes += output.candidateNodes.length;
    totalRelations += output.candidateRelations.length;
  }

  await writeState(graphPath, syncStart);

  if (totalNodes === 0) {
    process.stderr.write("[notion-sync] No candidates extracted from any page\n");
    return;
  }

  process.stderr.write(
    `[notion-sync] Done — ${totalNodes} candidates, ${totalRelations} relations → ${path.basename(lastFile)}\n`,
  );
}

run().catch((err) => {
  process.stderr.write(`[notion-sync] Fatal: ${String(err)}\n`);
  process.exit(1);
});
