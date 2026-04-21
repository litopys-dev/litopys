import { For, Show, createResource } from "solid-js";
import { api } from "../api.ts";
import { SkeletonCard } from "../components/Skeleton.tsx";
import { TypeChip } from "../components/TypeChip.tsx";

export default function Quarantine() {
  const [files] = createResource(() => api.quarantine());

  return (
    <div class="p-8 max-w-5xl">
      <header class="mb-6">
        <h1 class="font-heading font-semibold text-text-primary text-2xl mb-1">Quarantine</h1>
        <p class="text-text-secondary text-sm">
          Pending extractor candidates awaiting review. Accept/reject actions arrive in Phase 4.
        </p>
      </header>

      <Show when={!files.loading} fallback={<SkeletonCard />}>
        <Show
          when={(files() ?? []).length > 0}
          fallback={
            <div class="bg-surface border border-border rounded-card px-5 py-8 text-center text-text-tertiary text-sm">
              No pending quarantine items.
            </div>
          }
        >
          <ul class="space-y-3">
            <For each={files()}>
              {(f) => (
                <li class="bg-surface border border-border rounded-card p-4">
                  <div class="flex items-start justify-between gap-3 mb-3">
                    <div class="min-w-0">
                      <div class="font-mono text-xs text-text-tertiary truncate">{f.filePath}</div>
                      <div class="mt-0.5 text-text-secondary text-xs">
                        {f.meta.adapterName} · {f.meta.timestamp}
                      </div>
                    </div>
                    <div class="flex gap-2 shrink-0 font-mono text-xs text-text-tertiary tabular-nums">
                      <span>{f.candidateCount} cand</span>
                      <span>·</span>
                      <span>{f.relationCount} rel</span>
                    </div>
                  </div>
                  <Show when={f.candidates.length > 0}>
                    <ul class="space-y-1.5 pl-1">
                      <For each={f.candidates}>
                        {(c) => (
                          <li class="flex items-center gap-3 text-sm">
                            <TypeChip type={c.type} />
                            <span class="font-mono text-text-primary">{c.id}</span>
                            <span class="text-text-secondary truncate flex-1">{c.summary}</span>
                            <span class="font-mono text-xs text-text-tertiary tabular-nums">
                              {c.confidence.toFixed(2)}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </li>
              )}
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
