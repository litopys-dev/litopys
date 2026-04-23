import { CheckCircle, ChevronDown, ChevronRight, GitMerge, X } from "lucide-solid";
import {
  For,
  Show,
  createResource,
  createSignal,
  type Setter,
} from "solid-js";
import {
  type MergeConflictPayload,
  type MergeProposalPayload,
  type QuarantineCandidate,
  type QuarantineFile,
  type QuarantineMergeFile,
  type QuarantineRegularFile,
  type QuarantineRelation,
  api,
} from "../api.ts";
import { SkeletonCard } from "../components/Skeleton.tsx";
import { TypeChip } from "../components/TypeChip.tsx";

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------

export default function Quarantine() {
  const [files, { refetch }] = createResource<QuarantineFile[]>(() => api.quarantine());
  const [toast, setToast] = createSignal<string | null>(null);
  const [globalError, setGlobalError] = createSignal<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const onAction = (msg: string) => {
    showToast(msg);
    void refetch();
  };

  return (
    <div class="p-8 max-w-5xl">
      <header class="mb-6">
        <h1 class="font-heading font-semibold text-text-primary text-2xl mb-1">Quarantine</h1>
        <p class="text-text-secondary text-sm">
          Pending extractor candidates waiting for review. Accept to promote to the graph, reject to
          discard.
        </p>
      </header>

      {/* Toast */}
      <Show when={toast()}>
        <div class="mb-4 flex items-center gap-2 bg-accent/10 border border-accent/40 rounded-card px-4 py-2.5 text-accent text-sm">
          <CheckCircle size={15} class="shrink-0" />
          {toast()}
        </div>
      </Show>

      {/* Global error */}
      <Show when={globalError()}>
        <div class="mb-4 bg-destructive/10 border border-destructive/40 rounded-card px-3 py-2 text-destructive text-sm font-mono">
          {globalError()}
        </div>
      </Show>

      <Show when={!files.loading} fallback={<SkeletonCard />}>
        <Show
          when={(files() ?? []).length > 0}
          fallback={
            <div class="bg-surface border border-border rounded-card px-5 py-8 text-center text-text-tertiary text-sm">
              No pending quarantine items.
            </div>
          }
        >
          <ul class="space-y-4">
            <For each={files()}>
              {(f) =>
                f.kind === "merge" ? (
                  <MergeCard
                    file={f}
                    onAction={onAction}
                    setError={setGlobalError}
                  />
                ) : (
                  <RegularCard
                    file={f}
                    onAction={onAction}
                    setError={setGlobalError}
                  />
                )
              }
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={files.error}>
        <div class="mt-4 text-destructive text-sm font-mono">
          Error loading quarantine: {String(files.error)}
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regular quarantine file card
// ---------------------------------------------------------------------------

function RegularCard(props: {
  file: QuarantineRegularFile;
  onAction: (msg: string) => void;
  setError: Setter<string | null>;
}) {
  const f = props.file;

  return (
    <li class="bg-surface border border-border rounded-card overflow-hidden">
      {/* File header */}
      <div class="px-4 pt-3 pb-2 border-b border-border bg-elevated/40 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="font-mono text-xs text-text-tertiary truncate">{f.filePath}</div>
          <div class="mt-0.5 text-text-secondary text-xs">
            {f.meta.adapterName} · {f.meta.timestamp}
          </div>
        </div>
        <div class="flex gap-2 shrink-0 font-mono text-xs text-text-tertiary tabular-nums pt-0.5">
          <span>{f.candidateCount} cand</span>
          <span>·</span>
          <span>{f.relationCount} rel</span>
        </div>
      </div>

      {/* Candidates */}
      <Show when={f.candidates.length > 0}>
        <ul class="divide-y divide-border/60">
          <For each={f.candidates}>
            {(c, idx) => (
              <CandidateRow
                candidate={c}
                index={idx()}
                filePath={f.filePath}
                onAction={props.onAction}
                setError={props.setError}
              />
            )}
          </For>
        </ul>
      </Show>

      {/* Relations block */}
      <Show when={f.relations.length > 0}>
        <RelationsList relations={f.relations} />
      </Show>
    </li>
  );
}

function CandidateRow(props: {
  candidate: QuarantineCandidate;
  index: number;
  filePath: string;
  onAction: (msg: string) => void;
  setError: Setter<string | null>;
}) {
  const c = props.candidate;
  const [busy, setBusy] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  const accept = async () => {
    setBusy(true);
    props.setError(null);
    try {
      await api.acceptQuarantine(props.filePath, props.index);
      props.onAction(`Accepted candidate ${c.id}`);
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    const reason = window.prompt(`Reason for rejecting "${c.id}" (optional):`);
    if (reason === null) return; // user cancelled
    setBusy(true);
    props.setError(null);
    try {
      await api.rejectQuarantine(props.filePath, props.index, reason || undefined);
      props.onAction(`Rejected candidate ${c.id}`);
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li class="px-4 py-3">
      {/* Main row */}
      <div class="flex items-start gap-3">
        <TypeChip type={c.type} />
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2">
            <span class="font-mono text-text-primary text-sm">{c.id}</span>
            <span class="font-mono text-text-tertiary text-xs tabular-nums">
              {c.confidence.toFixed(2)}
            </span>
          </div>
          <p class="text-text-secondary text-sm mt-0.5 break-words">{c.summary}</p>
        </div>
        {/* Action buttons */}
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title="Toggle reasoning"
            class="inline-flex items-center p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-elevated transition-colors"
            aria-expanded={expanded()}
          >
            <Show when={expanded()} fallback={<ChevronRight size={14} />}>
              <ChevronDown size={14} />
            </Show>
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={busy()}
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-card text-xs font-medium text-destructive hover:bg-destructive/10 border border-border transition-colors disabled:opacity-40"
          >
            <X size={12} />
            Reject
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={busy()}
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-card text-xs font-medium bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25 transition-colors disabled:opacity-40"
          >
            <CheckCircle size={12} />
            Accept
          </button>
        </div>
      </div>

      {/* Reasoning (expandable) */}
      <Show when={expanded() && c.reasoning}>
        <div class="mt-2 ml-[calc(theme(spacing.16)_+_theme(spacing.3))] text-xs text-text-tertiary bg-ink/50 border border-border/60 rounded px-3 py-2 leading-relaxed">
          {c.reasoning}
        </div>
      </Show>
    </li>
  );
}

function RelationsList(props: { relations: QuarantineRelation[] }) {
  return (
    <div class="border-t border-border/60 px-4 py-2 bg-ink/20">
      <div class="text-text-tertiary text-xs uppercase tracking-wide mb-1.5">
        Relations ({props.relations.length})
      </div>
      <ul class="space-y-1">
        <For each={props.relations}>
          {(r) => (
            <li class="flex items-center gap-2 text-xs font-mono text-text-secondary">
              <span class="text-text-primary">{r.sourceId}</span>
              <span class="chip bg-elevated text-text-tertiary text-[10px] px-1.5 py-0.5">
                {r.type}
              </span>
              <span class="text-text-primary">{r.targetId}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge proposal card
// ---------------------------------------------------------------------------

function MergeCard(props: {
  file: QuarantineMergeFile;
  onAction: (msg: string) => void;
  setError: Setter<string | null>;
}) {
  const p = props.file.proposal;
  const [busy, setBusy] = createSignal(false);

  const accept = async () => {
    if (
      !confirm(
        `Apply merge proposal?\n\n${p.result.loserId} → ${p.result.winnerId}\n\nThe loser node will be tombstoned and the winner will absorb its aliases, tags, and relations.`,
      )
    )
      return;
    setBusy(true);
    props.setError(null);
    try {
      await api.acceptQuarantine(props.file.filePath);
      props.onAction(`Merged ${p.result.loserId} → ${p.result.winnerId}`);
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    props.setError(null);
    try {
      await api.rejectQuarantine(props.file.filePath);
      props.onAction(`Rejected merge proposal: ${props.file.filePath}`);
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li class="bg-surface border border-border rounded-card overflow-hidden">
      {/* Header */}
      <div class="px-4 pt-3 pb-2 border-b border-border bg-elevated/40 flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <GitMerge size={15} class="text-accent shrink-0" />
          <div class="min-w-0">
            <div class="font-mono text-xs text-text-tertiary truncate">
              {props.file.filePath}
            </div>
            <div class="mt-0.5 text-text-secondary text-xs">
              Merge proposal · detected by {p.detectedBy}
            </div>
          </div>
        </div>
        <div class="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={reject}
            disabled={busy()}
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-card text-xs font-medium text-destructive hover:bg-destructive/10 border border-border transition-colors disabled:opacity-40"
          >
            <X size={12} />
            Reject
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={busy()}
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-card text-xs font-medium bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25 transition-colors disabled:opacity-40"
          >
            <GitMerge size={12} />
            Accept merge
          </button>
        </div>
      </div>

      {/* Merge arrow: loser → winner */}
      <div class="px-4 py-4">
        <div class="flex items-center gap-3 mb-4">
          <div class="bg-ink border border-border rounded-card px-3 py-2 min-w-0">
            <div class="text-text-tertiary text-[10px] uppercase tracking-wide mb-0.5">Loser</div>
            <div class="font-mono text-sm text-text-primary">{p.result.loserId}</div>
          </div>
          <div class="text-text-tertiary text-lg select-none shrink-0">→</div>
          <div class="bg-accent/10 border border-accent/40 rounded-card px-3 py-2 min-w-0">
            <div class="text-accent/70 text-[10px] uppercase tracking-wide mb-0.5">Winner</div>
            <div class="font-mono text-sm text-accent">{p.result.winnerId}</div>
          </div>
        </div>

        {/* Conflicts */}
        <Show when={p.conflicts.length > 0}>
          <div class="mb-4">
            <div class="text-text-tertiary text-xs uppercase tracking-wide mb-1.5">
              Conflicts ({p.conflicts.length})
            </div>
            <ul class="space-y-1">
              <For each={p.conflicts}>
                {(conflict) => <ConflictRow conflict={conflict} />}
              </For>
            </ul>
          </div>
        </Show>

        {/* Merged final state */}
        <MergedPreview proposal={p} />
      </div>
    </li>
  );
}

function ConflictRow(props: { conflict: MergeConflictPayload }) {
  return (
    <li class="flex items-start gap-2 text-xs bg-destructive/5 border border-destructive/30 rounded px-3 py-1.5">
      <span class="chip bg-destructive/20 text-destructive text-[10px] shrink-0 mt-0.5">
        {props.conflict.field}
      </span>
      <span class="text-text-secondary leading-relaxed">{props.conflict.detail}</span>
    </li>
  );
}

function MergedPreview(props: { proposal: MergeProposalPayload }) {
  const r = props.proposal.result;
  const relEntries = Object.entries(r.rels ?? {}).filter(([, targets]) => targets && targets.length > 0);

  return (
    <div class="border border-border rounded-card p-3 bg-ink/20">
      <div class="text-text-tertiary text-xs uppercase tracking-wide mb-2">
        Merged result preview
      </div>
      <div class="space-y-1.5 text-sm">
        <Show when={r.summary}>
          <div class="text-text-secondary">{r.summary}</div>
        </Show>
        <div class="flex flex-wrap gap-1.5 text-xs font-mono">
          <span class="text-text-tertiary">conf:</span>
          <span class="text-text-primary tabular-nums">{r.confidence.toFixed(2)}</span>
        </div>
        <Show when={r.aliases.length > 0}>
          <div class="flex flex-wrap gap-1">
            <span class="text-text-tertiary text-xs">aliases:</span>
            <For each={r.aliases}>
              {(a) => (
                <span class="chip bg-elevated text-text-secondary font-mono text-[10px]">{a}</span>
              )}
            </For>
          </div>
        </Show>
        <Show when={r.tags.length > 0}>
          <div class="flex flex-wrap gap-1">
            <span class="text-text-tertiary text-xs">tags:</span>
            <For each={r.tags}>
              {(t) => (
                <span class="chip bg-elevated text-text-secondary font-mono text-[10px]">{t}</span>
              )}
            </For>
          </div>
        </Show>
        <Show when={relEntries.length > 0}>
          <div>
            <span class="text-text-tertiary text-xs">rels:</span>
            <ul class="mt-1 space-y-0.5 ml-2">
              <For each={relEntries}>
                {([rel, targets]) => (
                  <li class="flex items-center gap-1.5 text-xs font-mono">
                    <span class="chip bg-elevated text-text-tertiary text-[10px]">{rel}</span>
                    <span class="text-text-secondary">{(targets ?? []).join(", ")}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>
    </div>
  );
}
