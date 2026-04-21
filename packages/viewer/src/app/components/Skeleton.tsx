import { For } from "solid-js";

interface SkeletonRowsProps {
  rows?: number;
  cols?: number;
}

export function SkeletonRows(props: SkeletonRowsProps) {
  const rows = () => props.rows ?? 8;
  const cols = () => props.cols ?? 4;

  return (
    <output class="block space-y-1" aria-label="Loading...">
      <For each={Array.from({ length: rows() })}>
        {() => (
          <div class="flex gap-4 px-4 py-2.5">
            <For each={Array.from({ length: cols() })}>
              {(_, i) => (
                <div class="skeleton h-4 rounded" style={{ width: i() === 0 ? "40%" : "20%" }} />
              )}
            </For>
          </div>
        )}
      </For>
    </output>
  );
}

export function SkeletonCard() {
  return <output class="skeleton block h-24 rounded-card" aria-label="Loading..." />;
}
