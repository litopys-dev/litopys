import { CheckCircle, ChevronDown, ChevronRight, X } from "lucide-solid";
import { For, type Setter, Show, createResource, createSignal } from "solid-js";
import { type SkillDraftListItem, api } from "../api.ts";
import { SkeletonCard } from "../components/Skeleton.tsx";
import { episodesWord, sessionsWord, t } from "../i18n.ts";

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------

export default function SkillDrafts() {
  const [drafts, { refetch }] = createResource<SkillDraftListItem[]>(() => api.skillDrafts());
  const [toast, setToast] = createSignal<string | null>(null);
  const [globalError, setGlobalError] = createSignal<string | null>(null);
  const [hiddenNames, setHiddenNames] = createSignal(new Set<string>());

  const hide = (name: string) =>
    setHiddenNames((s) => {
      const n = new Set(s);
      n.add(name);
      return n;
    });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const onAction = (msg: string, name: string) => {
    hide(name);
    showToast(msg);
    void refetch();
  };

  return (
    <div class="p-8 max-w-5xl">
      <header class="mb-6">
        <h1 class="font-heading font-semibold text-text-primary text-2xl mb-1">
          {t("skills.title")}
        </h1>
        <p class="text-text-secondary text-sm">{t("skills.subtitle")}</p>
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

      <Show when={!drafts.loading} fallback={<SkeletonCard />}>
        <Show
          when={(drafts() ?? []).filter((d) => !hiddenNames().has(d.meta.name)).length > 0}
          fallback={
            <div class="bg-surface border border-border rounded-card px-5 py-8 text-center text-text-tertiary text-sm">
              {t("skills.empty")}
            </div>
          }
        >
          <ul class="space-y-4">
            <For each={drafts()}>
              {(draft) => {
                if (hiddenNames().has(draft.meta.name)) return null;
                return (
                  <DraftCard
                    draft={draft}
                    onAction={onAction}
                    setError={setGlobalError}
                  />
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={drafts.error}>
        <div class="mt-4 text-destructive text-sm font-mono">
          {t("skills.loadError", { msg: String(drafts.error) })}
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft card
// ---------------------------------------------------------------------------

function DraftCard(props: {
  draft: SkillDraftListItem;
  onAction: (msg: string, name: string) => void;
  setError: Setter<string | null>;
}) {
  const d = props.draft;
  const [busy, setBusy] = createSignal(false);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [skillMd, setSkillMd] = createSignal<string | null>(null);

  const togglePreview = async () => {
    if (previewOpen()) {
      setPreviewOpen(false);
      return;
    }
    if (skillMd() === null) {
      try {
        const detail = await api.skillDraft(d.meta.name);
        setSkillMd(detail.skillMd);
      } catch (e) {
        props.setError(String((e as Error).message ?? e));
        return;
      }
    }
    setPreviewOpen(true);
  };

  const promote = async () => {
    setBusy(true);
    props.setError(null);
    try {
      await api.promoteSkill(d.meta.name);
      props.onAction(t("skills.promoted", { name: d.meta.name }), d.meta.name);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      // 409 = already installed — ask user to confirm force
      if (msg.includes("409") || msg.toLowerCase().includes("already installed")) {
        if (!confirm(t("skills.promoteConflict", { name: d.meta.name }))) {
          setBusy(false);
          return;
        }
        try {
          await api.promoteSkill(d.meta.name, true);
          props.onAction(t("skills.promoted", { name: d.meta.name }), d.meta.name);
        } catch (e2) {
          props.setError(String((e2 as Error).message ?? e2));
        }
      } else {
        props.setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    const reason = window.prompt(t("skills.rejectPrompt", { name: d.meta.name }));
    if (reason === null) return; // user cancelled
    setBusy(true);
    props.setError(null);
    try {
      await api.rejectSkill(d.meta.name, reason || undefined);
      props.onAction(t("skills.rejected", { name: d.meta.name }), d.meta.name);
    } catch (e) {
      props.setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const createdDate = () => {
    try {
      return new Date(d.meta.createdAt).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return d.meta.createdAt;
    }
  };

  return (
    <li class="bg-surface border border-border rounded-card overflow-hidden">
      {/* Card header */}
      <div class="px-4 pt-3 pb-2 border-b border-border bg-elevated/40 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-sm text-text-primary truncate">{d.meta.name}</div>
          <Show when={d.description}>
            <p class="mt-0.5 text-text-secondary text-xs leading-relaxed">{d.description}</p>
          </Show>
        </div>
        <div class="flex gap-2 shrink-0 font-mono text-xs text-text-tertiary tabular-nums pt-0.5">
          <span>
            {d.meta.episodeIds.length}&nbsp;{episodesWord(d.meta.episodeIds.length)}
          </span>
          <span>·</span>
          <span>
            {d.meta.sessions.length}&nbsp;{sessionsWord(d.meta.sessions.length)}
          </span>
          <span>·</span>
          <span>{createdDate()}</span>
        </div>
      </div>

      {/* Action row */}
      <div class="px-4 py-2.5 flex items-center gap-2">
        {/* Preview toggle */}
        <button
          type="button"
          onClick={togglePreview}
          class="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          aria-expanded={previewOpen()}
        >
          <Show when={previewOpen()} fallback={<ChevronRight size={12} />}>
            <ChevronDown size={12} />
          </Show>
          <Show when={previewOpen()} fallback={t("skills.preview")}>
            {t("skills.hidePreview")}
          </Show>
        </button>

        <div class="flex-1" />

        {/* Reject */}
        <button
          type="button"
          onClick={reject}
          disabled={busy()}
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded-card text-xs font-medium text-destructive hover:bg-destructive/10 border border-border transition-colors disabled:opacity-40"
        >
          <X size={12} />
          {t("skills.reject")}
        </button>

        {/* Promote / Install */}
        <button
          type="button"
          onClick={promote}
          disabled={busy()}
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded-card text-xs font-medium bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25 transition-colors disabled:opacity-40"
        >
          <CheckCircle size={12} />
          {t("skills.install")}
        </button>
      </div>

      {/* SKILL.md preview */}
      <Show when={previewOpen() && skillMd() !== null}>
        <div class="border-t border-border">
          <pre class="bg-surface px-4 py-3 whitespace-pre-wrap text-xs text-text-primary font-sans leading-relaxed overflow-x-auto max-h-96 overflow-y-auto">
            {skillMd()}
          </pre>
        </div>
      </Show>
    </li>
  );
}
