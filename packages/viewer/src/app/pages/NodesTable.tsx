import { A } from "@solidjs/router";
import { Search } from "lucide-solid";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { type NodeRow, type NodeType, api } from "../api.ts";
import { SkeletonRows } from "../components/Skeleton.tsx";
import { TypeChip } from "../components/TypeChip.tsx";

const TYPE_ORDER: NodeType[] = ["person", "project", "system", "concept", "event", "lesson"];

export default function NodesTable() {
  const [nodes] = createResource(() => api.nodes());
  const [query, setQuery] = createSignal("");
  const [activeTypes, setActiveTypes] = createSignal<Set<NodeType>>(new Set());

  const toggleType = (t: NodeType) => {
    const next = new Set(activeTypes());
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setActiveTypes(next);
  };

  const filtered = createMemo(() => {
    const list = nodes() ?? [];
    const q = query().trim().toLowerCase();
    const types = activeTypes();
    return list.filter((n) => {
      if (types.size > 0 && !types.has(n.type)) return false;
      if (!q) return true;
      return (
        n.id.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  });

  return (
    <div class="p-8 max-w-6xl">
      <header class="mb-6">
        <h1 class="font-heading font-semibold text-text-primary text-2xl mb-1">Nodes</h1>
        <p class="text-text-secondary text-sm">
          <Show when={!nodes.loading} fallback="Loading…">
            {filtered().length} of {nodes()?.length ?? 0} nodes
          </Show>
        </p>
      </header>

      {/* Controls */}
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <div class="relative flex-1 min-w-60 max-w-md">
          <Search
            size={14}
            class="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          />
          <input
            type="search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search id, summary, tags…"
            aria-label="Search nodes"
            class="w-full bg-surface border border-border rounded-card pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none transition-colors"
          />
        </div>
        <fieldset class="flex flex-wrap gap-1.5 border-0 p-0 m-0">
          <legend class="sr-only">Filter by type</legend>
          <For each={TYPE_ORDER}>
            {(t) => {
              const active = () => activeTypes().has(t);
              return (
                <button
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={active()}
                  class="chip transition-opacity duration-150"
                  classList={{
                    [`chip-${t}`]: true,
                    "opacity-100 ring-1 ring-current": active(),
                    "opacity-60 hover:opacity-100": !active(),
                  }}
                >
                  {t}
                </button>
              );
            }}
          </For>
          <Show when={activeTypes().size > 0}>
            <button
              type="button"
              onClick={() => setActiveTypes(new Set())}
              class="text-xs text-text-tertiary hover:text-text-primary transition-colors px-2"
            >
              clear
            </button>
          </Show>
        </fieldset>
      </div>

      {/* Table */}
      <div class="bg-surface border border-border rounded-card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-elevated border-b border-border">
            <tr class="text-left text-text-secondary">
              <th class="px-4 py-2.5 font-medium w-24">Type</th>
              <th class="px-4 py-2.5 font-medium">Id</th>
              <th class="px-4 py-2.5 font-medium">Summary</th>
              <th class="px-4 py-2.5 font-medium w-28 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            <Show when={!nodes.loading} fallback={<SkeletonLoadingRows />}>
              <Show
                when={filtered().length > 0}
                fallback={
                  <tr>
                    <td colspan="4" class="px-4 py-8 text-center text-text-tertiary text-sm">
                      No nodes match the current filters.
                    </td>
                  </tr>
                }
              >
                <For each={filtered()}>{(n) => <NodeRowView node={n} />}</For>
              </Show>
            </Show>
          </tbody>
        </table>
      </div>

      <Show when={nodes.error}>
        <div class="mt-4 text-destructive text-sm font-mono">
          Error loading nodes: {String(nodes.error)}
        </div>
      </Show>
    </div>
  );
}

function NodeRowView(props: { node: NodeRow }) {
  return (
    <tr class="border-b border-divider last:border-b-0 hover:bg-elevated transition-colors">
      <td class="px-4 py-2.5">
        <TypeChip type={props.node.type} />
      </td>
      <td class="px-4 py-2.5">
        <A
          href={`/node/${encodeURIComponent(props.node.id)}`}
          class="font-mono text-sm text-text-primary hover:text-accent transition-colors"
        >
          {props.node.id}
        </A>
      </td>
      <td class="px-4 py-2.5 text-text-secondary truncate max-w-lg">{props.node.summary}</td>
      <td class="px-4 py-2.5 text-right font-mono text-xs text-text-tertiary tabular-nums">
        {props.node.updated}
      </td>
    </tr>
  );
}

function SkeletonLoadingRows() {
  return (
    <tr>
      <td colspan="4" class="p-0">
        <SkeletonRows rows={8} cols={4} />
      </td>
    </tr>
  );
}
