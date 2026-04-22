import { useNavigate } from "@solidjs/router";
import { X } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { type NodeType, api } from "../api.ts";

const TYPES: NodeType[] = ["person", "project", "system", "concept", "event", "lesson"];

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function NewNodeModal(props: { onClose: () => void }) {
  const navigate = useNavigate();
  const [type, setType] = createSignal<NodeType>("concept");
  const [id, setId] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [body, setBody] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [idTouched, setIdTouched] = createSignal(false);

  const onSummaryInput = (value: string) => {
    setSummary(value);
    if (!idTouched()) {
      setId(slugify(value));
    }
  };

  const create = async () => {
    const normalizedId = slugify(id().trim());
    if (!normalizedId) {
      setError("id is required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const resp = await api.createNode({
        id: normalizedId,
        type: type(),
        summary: summary().trim() || undefined,
        body: body() || undefined,
        tags: tags()
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        confidence: 1,
      });
      props.onClose();
      navigate(`/node/${encodeURIComponent(resp.node.id)}`);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={props.onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <div
        class="bg-surface border border-border rounded-card w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header class="flex items-center justify-between px-5 py-3 border-b border-divider">
          <h2 class="font-heading font-medium text-text-primary text-base">New node</h2>
          <button
            type="button"
            onClick={props.onClose}
            class="text-text-tertiary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div class="p-5 space-y-4">
          <Show when={error()}>
            <div class="bg-destructive/10 border border-destructive/40 rounded-card px-3 py-2 text-destructive text-sm font-mono">
              {error()}
            </div>
          </Show>

          <div class="block">
            <span class="block text-text-tertiary text-xs uppercase tracking-wide mb-1">Type</span>
            <div class="flex flex-wrap gap-1.5">
              <For each={TYPES}>
                {(t) => (
                  <button
                    type="button"
                    onClick={() => setType(t)}
                    class="chip cursor-pointer transition-all"
                    classList={{
                      [`chip-${t}`]: true,
                      "ring-2 ring-accent ring-offset-2 ring-offset-surface": type() === t,
                      "opacity-60 hover:opacity-100": type() !== t,
                    }}
                  >
                    {t}
                  </button>
                )}
              </For>
            </div>
          </div>

          <label class="block">
            <span class="block text-text-tertiary text-xs uppercase tracking-wide mb-1">
              Summary
            </span>
            <input
              type="text"
              value={summary()}
              onInput={(e) => onSummaryInput(e.currentTarget.value)}
              placeholder="One-line description"
              maxlength={200}
              class="w-full bg-ink border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none"
            />
          </label>

          <label class="block">
            <span class="block text-text-tertiary text-xs uppercase tracking-wide mb-1">
              ID (kebab-case) {!idTouched() && <span class="text-text-tertiary">— auto</span>}
            </span>
            <input
              type="text"
              value={id()}
              onInput={(e) => {
                setIdTouched(true);
                setId(e.currentTarget.value);
              }}
              onBlur={() => setId(slugify(id()))}
              placeholder="my-node-id"
              class="w-full bg-ink border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none font-mono"
            />
          </label>

          <label class="block">
            <span class="block text-text-tertiary text-xs uppercase tracking-wide mb-1">
              Tags (comma-separated)
            </span>
            <input
              type="text"
              value={tags()}
              onInput={(e) => setTags(e.currentTarget.value)}
              class="w-full bg-ink border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none font-mono"
            />
          </label>

          <label class="block">
            <span class="block text-text-tertiary text-xs uppercase tracking-wide mb-1">
              Body (markdown, optional)
            </span>
            <textarea
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
              rows={6}
              class="w-full bg-ink border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent outline-none font-mono"
            />
          </label>
        </div>

        <footer class="px-5 py-3 border-t border-divider flex gap-2 justify-end">
          <button
            type="button"
            onClick={props.onClose}
            disabled={creating()}
            class="px-3 py-1.5 rounded-card text-sm font-medium text-text-secondary hover:bg-elevated border border-border disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={creating() || !id().trim()}
            class="px-3 py-1.5 rounded-card text-sm font-medium bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 disabled:opacity-50"
          >
            {creating() ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
