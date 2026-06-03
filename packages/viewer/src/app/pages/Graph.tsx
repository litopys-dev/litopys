import { useNavigate } from "@solidjs/router";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
// @ts-expect-error — no types for fcose
import fcose from "cytoscape-fcose";
import { Maximize2 } from "lucide-solid";
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { type NodeType, type RelationName, api } from "../api.ts";
import { nodeTypeLabel, nodesWord, relationLabel, relationsWord, t } from "../i18n.ts";

cytoscape.use(fcose);

const TYPE_COLORS: Record<NodeType, string> = {
  person: "#fb7185",
  project: "#34d399",
  system: "#fbbf24",
  concept: "#a78bfa",
  event: "#38bdf8",
  lesson: "#2dd4bf",
};

const TYPE_SHAPES: Record<string, string> = {
  person: "ellipse",
  project: "round-rectangle",
  system: "diamond",
  concept: "hexagon",
  event: "ellipse",
  lesson: "round-rectangle",
};

const ALL_TYPES: NodeType[] = ["person", "project", "system", "concept", "event", "lesson"];

// Hub detection: top 15% by degree, minimum 3
const HUB_RATIO = 0.15;
const HUB_MIN = 3;
// Per-hub: how many non-hub edges to keep visible in ambient state
const HUB_VISIBLE_EDGES = 4;

function calcNodeSize(el: cytoscape.NodeSingular): number {
  return Math.min(56, 22 + Math.sqrt(el.degree(false)) * 7);
}

export default function Graph() {
  const navigate = useNavigate();
  const [data] = createResource(() => api.graph());
  const [hiddenTypes, setHiddenTypes] = createSignal(new Set<NodeType>());
  const [tooltip, setTooltip] = createSignal<{
    x: number;
    y: number;
    label: string;
    type: NodeType;
  } | null>(null);
  let containerRef: HTMLDivElement | undefined;
  let cy: Core | undefined;

  // ---------------------------------------------------------------------------
  // Ambient state — hub glow + selective edge visibility
  // ---------------------------------------------------------------------------

  function applyAmbientState() {
    if (!cy) return;
    cy.elements().removeClass("a-hub a-dim a-hub-edge a-mid-edge a-dim-edge");

    const nodes = cy.nodes().filter((n) => n.style("display") !== "none");
    const sorted = [...nodes].sort((a, b) => b.degree(false) - a.degree(false));
    const hubCount = Math.max(HUB_MIN, Math.ceil(sorted.length * HUB_RATIO));
    const hubIds = new Set(sorted.slice(0, hubCount).map((n) => n.id()));

    for (const n of nodes.toArray()) {
      n.addClass(hubIds.has(n.id()) ? "a-hub" : "a-dim");
    }

    const edges = cy.edges().filter((e) => e.style("display") !== "none");

    // Hub-to-hub edges are always fully visible
    for (const e of edges.toArray() as cytoscape.EdgeSingular[]) {
      if (hubIds.has(e.source().id()) && hubIds.has(e.target().id())) {
        e.addClass("a-hub-edge");
      }
    }

    // Per-hub: top HUB_VISIBLE_EDGES edges to non-hub nodes
    for (const hubId of hubIds) {
      const hubNode = cy.$id(hubId);
      const nonHubEdges = hubNode
        .connectedEdges()
        .filter((e) => e.style("display") !== "none" && !e.hasClass("a-hub-edge"));
      const byTargetDeg = [...nonHubEdges].sort((a, b) => {
        const aOther = a.source().id() === hubId ? a.target() : a.source();
        const bOther = b.source().id() === hubId ? b.target() : b.source();
        return bOther.degree(false) - aOther.degree(false);
      });
      byTargetDeg.forEach((e, i) => {
        e.addClass(i < HUB_VISIBLE_EDGES ? "a-mid-edge" : "a-dim-edge");
      });
    }

    // All other edges → dim
    edges.not(".a-hub-edge, .a-mid-edge, .a-dim-edge").addClass("a-dim-edge");
  }

  // ---------------------------------------------------------------------------
  // Type filter
  // ---------------------------------------------------------------------------

  function applyTypeVisibility() {
    if (!cy) return;
    const hidden = hiddenTypes();
    for (const n of cy.nodes().toArray()) {
      n.style("display", hidden.has(n.data("type") as NodeType) ? "none" : "element");
    }
    for (const e of cy.edges().toArray()) {
      const hide =
        hidden.has(e.source().data("type") as NodeType) ||
        hidden.has(e.target().data("type") as NodeType);
      e.style("display", hide ? "none" : "element");
    }
    applyAmbientState();
  }

  function toggleType(type: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    applyTypeVisibility();
  }

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------

  onMount(() => {
    const tryInit = () => {
      const payload = data();
      if (!payload || !containerRef) {
        setTimeout(tryInit, 50);
        return;
      }

      const elements: ElementDefinition[] = [
        ...payload.nodes.map((n) => ({ group: "nodes" as const, data: n.data })),
        ...payload.edges.map((e) => ({
          group: "edges" as const,
          data: {
            ...e.data,
            relLabel: relationLabel[e.data.relation as RelationName]?.label ?? e.data.relation,
          },
        })),
      ];

      cy = cytoscape({
        container: containerRef,
        elements,
        layout: {
          name: "fcose",
          animate: true,
          animationDuration: 900,
          nodeRepulsion: 12000,
          idealEdgeLength: 140,
          nodeSeparation: 120,
          padding: 60,
        } as cytoscape.LayoutOptions,
        wheelSensitivity: 0.2,
        minZoom: 0.15,
        maxZoom: 4,
        style: [
          // ── Base nodes ──────────────────────────────────────────────────────
          {
            selector: "node",
            style: {
              shape: (el: cytoscape.NodeSingular) =>
                (TYPE_SHAPES[el.data("type") as string] ?? "ellipse") as cytoscape.Css.NodeShape,
              "background-color": (el: cytoscape.NodeSingular) =>
                TYPE_COLORS[el.data("type") as NodeType] ?? "#9aa3ae",
              label: "data(label)",
              color: "#e6e8eb",
              "font-family": "JetBrains Mono, monospace",
              "font-size": 9,
              "text-valign": "bottom",
              "text-margin-y": 8,
              "text-outline-color": "#080a0d",
              "text-outline-width": 3,
              width: (el: cytoscape.NodeSingular) => calcNodeSize(el),
              height: (el: cytoscape.NodeSingular) => calcNodeSize(el),
              "border-width": 1.5,
              "border-color": (el: cytoscape.NodeSingular) =>
                TYPE_COLORS[el.data("type") as NodeType] ?? "#9aa3ae",
              "shadow-blur": 18,
              "shadow-color": (el: cytoscape.NodeSingular) =>
                TYPE_COLORS[el.data("type") as NodeType] ?? "#9aa3ae",
              "shadow-opacity": 0,
              "shadow-offset-x": 0,
              "shadow-offset-y": 0,
              "transition-property": "opacity shadow-opacity shadow-blur",
              "transition-duration": 200,
            },
          },
          // ── Ambient: hub nodes always glow ──────────────────────────────────
          {
            selector: "node.a-hub",
            style: { opacity: 1, "shadow-opacity": 0.85, "shadow-blur": 24 },
          },
          {
            selector: "node.a-dim",
            style: { opacity: 0.15, "shadow-opacity": 0 },
          },
          // ── Base edges ───────────────────────────────────────────────────────
          {
            selector: "edge",
            style: {
              width: 1.2,
              "line-color": "#2a3040",
              "target-arrow-color": "#2a3040",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.7,
              "curve-style": "bezier",
              label: "data(relLabel)",
              "font-family": "JetBrains Mono, monospace",
              "font-size": 8,
              color: "#4b5563",
              "text-rotation": "autorotate",
              "text-background-color": "#080a0d",
              "text-background-opacity": 0.9,
              "text-background-padding": "2px",
              opacity: 0.7,
              "transition-property": "opacity width line-color",
              "transition-duration": 200,
            },
          },
          // ── Ambient: edge tiers ──────────────────────────────────────────────
          {
            selector: "edge.a-hub-edge",
            style: {
              opacity: 0.8,
              width: 1.8,
              "line-color": "#3a4a60",
              "target-arrow-color": "#3a4a60",
            },
          },
          {
            selector: "edge.a-mid-edge",
            style: { opacity: 0.38 },
          },
          {
            selector: "edge.a-dim-edge",
            style: { opacity: 0.06 },
          },
          // ── Other base ───────────────────────────────────────────────────────
          {
            selector: "edge[?symmetric]",
            style: { "target-arrow-shape": "none", "line-style": "dashed" },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 2.5,
              "border-color": "#ffffff",
              "shadow-opacity": 1,
              "shadow-blur": 34,
            },
          },
          // ── Chain: hover override (higher specificity via order) ─────────────
          {
            selector: ".chain-dim",
            style: { opacity: 0.04 },
          },
          {
            selector: "node.chain-active",
            style: { opacity: 1, "shadow-opacity": 1, "shadow-blur": 34 },
          },
          {
            selector: "node.chain-mid",
            style: { opacity: 0.45, "shadow-opacity": 0.3, "shadow-blur": 16 },
          },
          {
            selector: "edge.chain-active",
            style: {
              opacity: 1,
              "line-color": "#60a5fa",
              "target-arrow-color": "#60a5fa",
              width: 2.5,
            },
          },
          {
            selector: "edge.chain-mid",
            style: { opacity: 0.28 },
          },
        ],
      });

      // Apply ambient state once layout animation completes
      cy.one("layoutstop", () => applyAmbientState());

      // ── Hover: chain activation (1-hop full, 2-hop partial) ─────────────────
      cy.on("mouseover", "node", (evt) => {
        const node = evt.target as cytoscape.NodeSingular;
        const oe = evt.originalEvent as MouseEvent;
        setTooltip({
          x: oe.clientX,
          y: oe.clientY,
          label: (node.data("label") as string) ?? node.id(),
          type: node.data("type") as NodeType,
        });

        const hop1 = node.closedNeighborhood(); // node + neighbors + edges
        const hop2nodes = node.neighborhood("node").neighborhood("node").not(hop1);
        const hop2edges = hop2nodes.edgesWith(hop1);

        cy?.elements().addClass("chain-dim");
        hop1.removeClass("chain-dim").addClass("chain-active");
        hop2nodes.removeClass("chain-dim").addClass("chain-mid");
        hop2edges.removeClass("chain-dim").addClass("chain-mid");
      });

      cy.on("mousemove", "node", (evt) => {
        const oe = evt.originalEvent as MouseEvent;
        setTooltip((t) => (t ? { ...t, x: oe.clientX, y: oe.clientY } : null));
      });

      cy.on("mouseout", "node", () => {
        setTooltip(null);
        cy?.elements().removeClass("chain-dim chain-active chain-mid");
      });

      cy.on("tap", "node", (evt) => {
        navigate(`/node/${encodeURIComponent(evt.target.id())}`);
      });
    };
    tryInit();
  });

  onCleanup(() => cy?.destroy());

  const fit = () => cy?.fit(undefined, 40);

  return (
    <div class="h-dvh flex flex-col">
      <header class="flex items-center justify-between px-8 py-5 border-b border-divider">
        <div>
          <h1 class="font-heading font-semibold text-text-primary text-2xl mb-0.5">
            {t("graph.title")}
          </h1>
          <p class="text-text-secondary text-sm">
            <Show when={data()} fallback={t("common.loading")}>
              {(d) => (
                <>
                  {d().nodes.length} {nodesWord(d().nodes.length)} · {d().edges.length}{" "}
                  {relationsWord(d().edges.length)} · {t("graph.hint")}
                </>
              )}
            </Show>
          </p>
        </div>
        <button
          type="button"
          onClick={fit}
          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-card text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-elevated border border-border transition-colors"
        >
          <Maximize2 size={14} />
          {t("graph.fit")}
        </button>
      </header>

      {/* Type filter bar */}
      <div class="flex items-center gap-2 px-8 py-2.5 border-b border-divider bg-surface">
        <For each={ALL_TYPES}>
          {(type) => {
            const isHidden = () => hiddenTypes().has(type);
            return (
              <button
                type="button"
                onClick={() => toggleType(type)}
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium border transition-all"
                style={{
                  color: isHidden() ? "#6b7280" : TYPE_COLORS[type],
                  "border-color": isHidden() ? "#262b33" : `${TYPE_COLORS[type]}55`,
                  background: isHidden() ? "transparent" : `${TYPE_COLORS[type]}12`,
                }}
              >
                <span
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: isHidden() ? "#3a4050" : TYPE_COLORS[type] }}
                />
                {nodeTypeLabel[type]}
              </button>
            );
          }}
        </For>
      </div>

      <div class="flex-1 relative graph-bg">
        <Show when={data.error}>
          <div class="absolute inset-0 flex items-center justify-center text-destructive text-sm font-mono">
            {t("graph.error", { msg: String(data.error) })}
          </div>
        </Show>
        <div ref={containerRef} class="absolute inset-0" />

        {/* Hover tooltip */}
        <Show when={tooltip()}>
          {(tip) => (
            <div
              class="fixed z-50 pointer-events-none"
              style={{
                left: `${tip().x}px`,
                top: `${tip().y - 14}px`,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div
                class="px-2.5 py-1.5 rounded-md text-xs font-mono backdrop-blur-sm whitespace-nowrap"
                style={{
                  background: "rgba(12, 15, 20, 0.93)",
                  border: `1px solid ${TYPE_COLORS[tip().type] ?? "#262b33"}66`,
                  "box-shadow": `0 0 18px ${TYPE_COLORS[tip().type] ?? "#0000"}30, 0 2px 8px rgba(0,0,0,0.5)`,
                  color: "#e6e8eb",
                }}
              >
                <span style={{ color: TYPE_COLORS[tip().type] ?? "#9aa3ae" }}>
                  {nodeTypeLabel[tip().type]}
                </span>
                <span class="mx-1.5" style={{ color: "#4b5563" }}>
                  ·
                </span>
                {tip().label}
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
