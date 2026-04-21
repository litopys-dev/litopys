import { Box, Database, Link2 } from "lucide-solid";
import { For, Show, createResource } from "solid-js";
import { type NodeType, api } from "../api.ts";
import { SkeletonCard } from "../components/Skeleton.tsx";
import { TypeChip } from "../components/TypeChip.tsx";

const TYPE_ORDER: NodeType[] = ["person", "project", "system", "concept", "event", "lesson"];

export default function Dashboard() {
  const [stats] = createResource(() => api.stats());

  return (
    <div class="p-8 max-w-4xl">
      <header class="mb-8">
        <h1 class="font-heading font-semibold text-text-primary text-2xl mb-1">Dashboard</h1>
        <p class="text-text-secondary text-sm">Graph overview — live from ~/.litopys/graph/</p>
      </header>

      {/* Top-level stats cards */}
      <div class="grid grid-cols-3 gap-4 mb-8">
        <Show when={!stats.loading} fallback={<SkeletonCard />}>
          <StatCard icon={<Database size={18} />} label="Nodes" value={stats()?.nodeCount ?? 0} />
        </Show>
        <Show when={!stats.loading} fallback={<SkeletonCard />}>
          <StatCard icon={<Link2 size={18} />} label="Edges" value={stats()?.edgeCount ?? 0} />
        </Show>
        <Show when={!stats.loading} fallback={<SkeletonCard />}>
          <StatCard
            icon={<Box size={18} />}
            label="Types"
            value={Object.keys(stats()?.typeBreakdown ?? {}).length}
          />
        </Show>
      </div>

      {/* Type breakdown */}
      <section aria-labelledby="type-breakdown-heading">
        <h2
          id="type-breakdown-heading"
          class="font-heading font-medium text-text-primary text-base mb-4"
        >
          By Type
        </h2>
        <Show
          when={!stats.loading}
          fallback={
            <div class="grid grid-cols-3 gap-3">
              <For each={[1, 2, 3, 4, 5, 6]}>
                {() => <div class="skeleton h-16 rounded-card" />}
              </For>
            </div>
          }
        >
          <div class="grid grid-cols-3 gap-3">
            <For each={TYPE_ORDER}>
              {(type) => {
                const count = () => stats()?.typeBreakdown[type] ?? 0;
                return (
                  <div class="bg-surface border border-border rounded-card px-4 py-3 flex items-center justify-between">
                    <TypeChip type={type} />
                    <span class="font-mono text-text-primary text-lg tabular-nums">{count()}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </section>

      <Show when={stats.error}>
        <div class="mt-6 text-destructive text-sm font-mono">
          Error loading stats: {String(stats.error)}
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: import("solid-js").JSX.Element;
  label: string;
  value: number;
}

function StatCard(props: StatCardProps) {
  return (
    <div class="bg-surface border border-border rounded-card px-5 py-4">
      <div class="flex items-center gap-2 text-text-secondary mb-2">
        {props.icon}
        <span class="text-sm font-medium">{props.label}</span>
      </div>
      <span class="font-mono text-text-primary text-3xl tabular-nums font-medium">
        {props.value}
      </span>
    </div>
  );
}
