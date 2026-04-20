/**
 * Source adapter types — agent-agnostic transcript ingestion layer.
 * Each adapter converts a specific transcript format into a uniform
 * TranscriptChunk for the LLM extractor.
 */

// ---------------------------------------------------------------------------
// TranscriptChunk — the unified intermediate format
// ---------------------------------------------------------------------------

export interface TranscriptChunk {
  /** Stable id for this chunk — used for incremental tracking (reserved for daemon, 6-3b). */
  sourceId: string;
  /** Session id if extractable from the source format; otherwise undefined. */
  sessionId?: string;
  /** Plain text passed to the LLM extractor. */
  text: string;
  /**
   * Byte offset from the start of the source file.
   * Reserved for incremental ingestion in the daemon (Part 6-3b).
   * Set to 0 for whole-file reads.
   */
  byteOffset?: number;
}

// ---------------------------------------------------------------------------
// SourceAdapter interface
// ---------------------------------------------------------------------------

export interface SourceAdapter {
  /** Short stable identifier, e.g. "text", "jsonl", "claude-code". */
  readonly name: string;

  /**
   * Returns true if this adapter knows how to handle the given spec string.
   * The spec is in the form "<adapter>:<path>" — adapters typically check
   * that the prefix matches their name.
   */
  match(spec: string): boolean;

  /**
   * Resolve a spec (which may contain globs) into a list of concrete file paths.
   * Returns an empty array if nothing matches.
   */
  list(spec: string): Promise<string[]>;

  /**
   * Read a single file and return a TranscriptChunk ready for extraction.
   */
  read(filePath: string): Promise<TranscriptChunk>;
}
