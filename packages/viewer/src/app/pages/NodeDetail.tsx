import { A, useNavigate, useParams } from "@solidjs/router";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Pencil, Plus, Trash2, X } from "lucide-solid";
import { For, Show, createResource, createSignal } from "solid-js";
import { type EdgeData, type RelationInput, type RelationName, api } from "../api.ts";
import { TypeChip } from "../components/TypeChip.tsx";

const RELATION_NAMES: RelationName[] = [
  "owns",
  "prefers",
  "learned_from",
  "uses",
  "applies_to",
  "conflicts_with",
  "runs_on",
  "depends_on",
  "reinforces",
  "mentioned_in",
  "supersedes",
];

export default function NodeDetail() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, { refetch }] = createResource(
    () => params.id,
    (id) => api.node(id),
  );

  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const onDelete = async () => {
    if (!confirm(`Tombstone node '${params.id}'? (soft delete, sets 'until' to today)`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteNode(params.id);
      navigate("/table");
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="p-8 max-w-4xl">
      <A
        href="/table"
        class="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm mb-4 transition-colors"
      >
        <ArrowLeft size={14} /> Back to nodes
      </A>

      <Show
        when={!detail.loading}
        fallback={<div class="text-text-secondary text-sm">Loading node…</div>}
      >
        <Show
          when={detail()}
          fallback={
            <div class="text-destructive text-sm font-mono">
              {detail.error ? String(detail.error) : "Node not found"}
            </div>
          }
        >
          {(data) => (
            <>
              <header class="mb-6 flex items-start gap-3">
                <TypeChip type={data().node.type} />
                <div class="flex-1 min-w-0">
                  <h1 class="font-mono text-text-primary text-xl mb-1 break-all">
                    {data().node.id}
                  </h1>
                  <Show when={data().node.summary && !editing()}>
                    <p class="text-text-secondary text-sm">{data().node.summary}</p>
                  </Show>
                  <Show when={data().node.until}>
                    <p class="text-destructive text-xs font-mono mt-1">
                      tombstoned until {data().node.until as string}
                    </p>
                  </Show>
                </div>
                <Show when={!editing()}>
                  <div class="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setError(null);
                      }}
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-elevated border border-border transition-colors"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={busy()}
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-sm font-medium text-destructive hover:bg-destructive/10 border border-border transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </Show>
              </header>

              <Show when={error()}>
                <div class="mb-4 bg-destructive/10 border border-destructive/40 rounded-card px-3 py-2 text-destructive text-sm font-mono">
                  {error()}
                </div>
              </Show>

              <Show when={editing()}>
                <EditForm
                  initial={data().node}
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    void refetch();
                  }}
                  setError={setError}
                />
              </Show>

              <Show when={!editing()}>
                {/* Metadata grid */}
                <section class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                  <MetaCard label="Updated" value={data().node.updated} mono />
                  <MetaCard label="Confidence" value={data().node.confidence.toFixed(2)} mono />
                  <Show when={data().node.tags?.length}>
                    <MetaCard label="Tags" value={(data().node.tags ?? []).join(", ")} />
                  </Show>
                  <Show when={data().node.aliases?.length}>
                    <MetaCard label="Aliases" value={(data().node.aliases ?? []).join(", ")} />
                  </Show>
                </section>

                {/* Body */}
                <Show when={data().node.body}>
                  <section class="mb-8" aria-labelledby="body-heading">
                    <h2
                      id="body-heading"
                      class="font-heading font-medium text-text-primary text-base mb-2"
                    >
                      Body
                    </h2>
                    <pre class="bg-surface border border-border rounded-card p-4 whitespace-pre-wrap text-sm text-text-primary font-sans leading-relaxed">
                      {data().node.body}
                    </pre>
                  </section>
                </Show>

                {/* Outgoing relations */}
                <Show when={data().outgoing.length > 0}>
                  <RelationSection
                    title="Outgoing"
                    direction="out"
                    edges={data().outgoing}
                    self={data().node.id}
                    onRemoved={refetch}
                    setError={setError}
                  />
                </Show>

                {/* Incoming relations */}
                <Show when={data().incoming.length > 0}>
                  <RelationSection
                    title="Incoming"
                    direction="in"
                    edges={data().incoming}
                    self={data().node.id}
                    onRemoved={refetch}
                    setError={setError}
                  />
                </Show>

                {/* Add relation */}
                <AddRelationForm sourceId={data().node.id} onAdded={refetch} setError={setError} />
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

function MetaCard(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="bg-surface border border-border rounded-card px-3 py-2">
      <div class="text-text-tertiary text-xs uppercase tracking-wide mb-0.5">{props.label}</div>
      <div
        class="text-text-primary text-sm truncate"
        classList={{ "font-mono": props.mono }}
        title={props.value}
      >
        {props.value}
      </div>
    </div>
  );
}

function EditForm(props: {
  initial: {
    id: string;
    summary?: string;
    body?: string;
    tags?: string[];
    aliases?: string[];
    confidence: number;
  };
  onCancel: () => void;
  onSaved: () => void;
  setError: (msg: string | null) => void;
}) {
  const [summary, setSummary] = createSignal(props.initial.summary ?? "");
  const [body, setBody] = createSignal(props.initial.body ?? "");
  const [tags, setTags] = createSignal((props.initial.tags ?? []).join(", "));
  const [aliases, setAliases] = createSignal((props.initial.aliases ?? []).join(", "));
  const [confidence, setConfidence] = createSignal(props.initial.confidence);
  const [saving, setSaving] = createSignal(false);

  const parseList = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  const save = async () => {
    setSaving(true);
    props.setError(null);
    try {
      await api.updateNode(props.initial.id, {
        summary: summary().trim() || null,
        body: body() || null,
        tags: parseList(tags()),
        aliases: parseList(aliases()),
        confidence: confidence(),
      });
      props.onSaved();
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section class="mb-8 bg-surface border border-border rounded-card p-4 space-y-4">
      <Field label="Summary">
        <input
          type="text"
          value={summary()}
          onInput={(e) => setSummary(e.currentTarget.value)}
          class="w-full bg-ink border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none"
          maxlength={200}
        />
      </Field>
      <Field label="Body">
        <textarea
          value={body()}
          onInput={(e) => setBody(e.currentTarget.value)}
          rows={8}
          class="w-full bg-ink border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent outline-none font-mono"
        />
      </Field>
      <Field label="Tags (comma-separated)">
        <input
          type="text"
          value={tags()}
          onInput={(e) => setTags(e.currentTarget.value)}
          class="w-full bg-ink border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none font-mono"
        />
      </Field>
      <Field label="Aliases (comma-separated)">
        <input
          type="text"
          value={aliases()}
          onInput={(e) => setAliases(e.currentTarget.value)}
          class="w-full bg-ink border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none font-mono"
        />
      </Field>
      <Field label={`Confidence: ${confidence().toFixed(2)}`}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={confidence()}
          onInput={(e) => setConfidence(Number(e.currentTarget.value))}
          class="w-full"
        />
      </Field>
      <div class="flex gap-2 justify-end">
        <button
          type="button"
          onClick={props.onCancel}
          disabled={saving()}
          class="px-3 py-1.5 rounded-card text-sm font-medium text-text-secondary hover:bg-elevated border border-border disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving()}
          class="px-3 py-1.5 rounded-card text-sm font-medium bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 disabled:opacity-50"
        >
          {saving() ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function Field(props: { label: string; children: import("solid-js").JSX.Element }) {
  return (
    <div class="block">
      <span class="block text-text-tertiary text-xs uppercase tracking-wide mb-1">
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

function RelationSection(props: {
  title: string;
  direction: "in" | "out";
  edges: EdgeData[];
  self: string;
  onRemoved: () => void;
  setError: (msg: string | null) => void;
}) {
  const [removing, setRemoving] = createSignal<string | null>(null);

  const removeEdge = async (edge: EdgeData) => {
    if (props.direction === "in") return; // incoming edges live on the other node
    const key = `${edge.relation}:${edge.to}`;
    if (!confirm(`Remove relation '${edge.relation}' → '${edge.to}'?`)) return;
    setRemoving(key);
    props.setError(null);
    try {
      await api.removeRelation(props.self, { relation: edge.relation, target: edge.to });
      props.onRemoved();
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section class="mb-6" aria-label={`${props.title} relations`}>
      <h2 class="font-heading font-medium text-text-primary text-base mb-2">
        {props.title}
        <span class="ml-2 text-text-tertiary text-sm font-normal">{props.edges.length}</span>
      </h2>
      <ul class="space-y-1">
        <For each={props.edges}>
          {(edge) => {
            const other = props.direction === "out" ? edge.to : edge.from;
            const key = `${edge.relation}:${other}`;
            return (
              <li class="bg-surface border border-border rounded-card px-3 py-2 flex items-center gap-3 text-sm">
                <span class="chip bg-elevated text-text-secondary font-mono text-xs">
                  {edge.relation}
                </span>
                <Show
                  when={edge.symmetric}
                  fallback={
                    props.direction === "out" ? (
                      <ArrowRight size={14} class="text-text-tertiary shrink-0" />
                    ) : (
                      <ArrowLeft size={14} class="text-text-tertiary shrink-0" />
                    )
                  }
                >
                  <ArrowLeftRight size={14} class="text-text-tertiary shrink-0" />
                </Show>
                <A
                  href={`/node/${encodeURIComponent(other)}`}
                  class="flex-1 font-mono text-text-primary hover:text-accent transition-colors truncate"
                >
                  {other}
                </A>
                <Show when={props.direction === "out"}>
                  <button
                    type="button"
                    onClick={() => removeEdge(edge)}
                    disabled={removing() === key}
                    class="text-text-tertiary hover:text-destructive transition-colors shrink-0 disabled:opacity-50"
                    aria-label={`Remove ${edge.relation} → ${other}`}
                  >
                    <X size={14} />
                  </button>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
}

function AddRelationForm(props: {
  sourceId: string;
  onAdded: () => void;
  setError: (msg: string | null) => void;
}) {
  const [relation, setRelation] = createSignal<RelationName>("uses");
  const [target, setTarget] = createSignal("");
  const [adding, setAdding] = createSignal(false);

  const add = async () => {
    if (!target().trim()) return;
    setAdding(true);
    props.setError(null);
    try {
      const input: RelationInput = { relation: relation(), target: target().trim() };
      await api.addRelation(props.sourceId, input);
      setTarget("");
      props.onAdded();
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section class="mt-6 bg-surface border border-border rounded-card p-3 flex items-center gap-2">
      <Plus size={14} class="text-text-tertiary shrink-0" />
      <select
        value={relation()}
        onChange={(e) => setRelation(e.currentTarget.value as RelationName)}
        class="bg-ink border border-border rounded px-2 py-1 text-sm text-text-primary font-mono focus:border-accent outline-none"
      >
        <For each={RELATION_NAMES}>{(r) => <option value={r}>{r}</option>}</For>
      </select>
      <input
        type="text"
        placeholder="target node id"
        value={target()}
        onInput={(e) => setTarget(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void add();
        }}
        class="flex-1 bg-ink border border-border rounded px-3 py-1 text-sm text-text-primary font-mono focus:border-accent outline-none"
      />
      <button
        type="button"
        onClick={add}
        disabled={adding() || !target().trim()}
        class="px-3 py-1 rounded-card text-sm font-medium bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 disabled:opacity-50"
      >
        {adding() ? "…" : "Add"}
      </button>
    </section>
  );
}
