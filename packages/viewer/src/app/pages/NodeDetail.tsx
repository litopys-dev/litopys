import { A, useParams } from "@solidjs/router";
import { ArrowLeft, ArrowLeftRight, ArrowRight } from "lucide-solid";
import { For, Show, createResource } from "solid-js";
import { type EdgeData, api } from "../api.ts";
import { TypeChip } from "../components/TypeChip.tsx";

export default function NodeDetail() {
  const params = useParams<{ id: string }>();
  const [detail] = createResource(
    () => params.id,
    (id) => api.node(id),
  );

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
                  <Show when={data().node.summary}>
                    <p class="text-text-secondary text-sm">{data().node.summary}</p>
                  </Show>
                </div>
              </header>

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
                />
              </Show>

              {/* Incoming relations */}
              <Show when={data().incoming.length > 0}>
                <RelationSection
                  title="Incoming"
                  direction="in"
                  edges={data().incoming}
                  self={data().node.id}
                />
              </Show>

              <Show when={data().outgoing.length === 0 && data().incoming.length === 0}>
                <p class="text-text-tertiary text-sm italic">No relations yet.</p>
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

function RelationSection(props: {
  title: string;
  direction: "in" | "out";
  edges: EdgeData[];
  self: string;
}) {
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
                  class="font-mono text-text-primary hover:text-accent transition-colors truncate"
                >
                  {other}
                </A>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
}
