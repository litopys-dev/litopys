import { useNavigate } from "@solidjs/router";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
// @ts-expect-error — cytoscape-fcose ships no types
import fcose from "cytoscape-fcose";
import { Maximize2 } from "lucide-solid";
import { Show, createResource, onCleanup, onMount } from "solid-js";
import { type NodeType, api } from "../api.ts";

cytoscape.use(fcose);

const TYPE_COLORS: Record<NodeType, string> = {
  person: "#fb7185",
  project: "#34d399",
  system: "#fbbf24",
  concept: "#a78bfa",
  event: "#38bdf8",
  lesson: "#2dd4bf",
};

export default function Graph() {
  const navigate = useNavigate();
  const [data] = createResource(() => api.graph());
  let containerRef: HTMLDivElement | undefined;
  let cy: Core | undefined;

  onMount(() => {
    // wait for resource then mount cytoscape
    const tryInit = () => {
      const payload = data();
      if (!payload || !containerRef) {
        setTimeout(tryInit, 50);
        return;
      }

      const elements: ElementDefinition[] = [
        ...payload.nodes.map((n) => ({
          group: "nodes" as const,
          data: n.data,
        })),
        ...payload.edges.map((e) => ({
          group: "edges" as const,
          data: e.data,
        })),
      ];

      cy = cytoscape({
        container: containerRef,
        elements,
        layout: {
          name: "fcose",
          animate: false,
          nodeRepulsion: 8000,
          idealEdgeLength: 120,
          nodeSeparation: 100,
          padding: 40,
        } as cytoscape.LayoutOptions,
        wheelSensitivity: 0.2,
        minZoom: 0.2,
        maxZoom: 3,
        style: [
          {
            selector: "node",
            style: {
              "background-color": (el: cytoscape.NodeSingular) =>
                TYPE_COLORS[el.data("type") as NodeType] ?? "#9aa3ae",
              label: "data(label)",
              color: "#e6e8eb",
              "font-family": "JetBrains Mono, monospace",
              "font-size": 10,
              "text-valign": "bottom",
              "text-margin-y": 6,
              "text-outline-color": "#0b0d10",
              "text-outline-width": 2,
              width: 18,
              height: 18,
              "border-width": 1,
              "border-color": "#0b0d10",
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-color": "#60a5fa",
              "border-width": 3,
              width: 24,
              height: 24,
            },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": "#262b33",
              "target-arrow-color": "#262b33",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.8,
              "curve-style": "bezier",
              label: "data(relation)",
              "font-family": "JetBrains Mono, monospace",
              "font-size": 8,
              color: "#6b7280",
              "text-rotation": "autorotate",
              "text-background-color": "#0b0d10",
              "text-background-opacity": 1,
              "text-background-padding": "2px",
            },
          },
          {
            selector: "edge[?symmetric]",
            style: {
              "target-arrow-shape": "none",
              "line-style": "dashed",
            },
          },
          {
            selector: ".dim",
            style: { opacity: 0.15 },
          },
          {
            selector: ".highlight",
            style: { opacity: 1 },
          },
          {
            selector: "edge.highlight",
            style: { "line-color": "#60a5fa", "target-arrow-color": "#60a5fa", width: 2 },
          },
        ],
      });

      cy.on("tap", "node", (evt) => {
        const id = evt.target.id();
        navigate(`/node/${encodeURIComponent(id)}`);
      });

      cy.on("mouseover", "node", (evt) => {
        const node = evt.target;
        const neighbors = node.closedNeighborhood();
        cy?.elements().addClass("dim");
        neighbors.removeClass("dim").addClass("highlight");
      });

      cy.on("mouseout", "node", () => {
        cy?.elements().removeClass("dim").removeClass("highlight");
      });
    };
    tryInit();
  });

  onCleanup(() => {
    cy?.destroy();
  });

  const fit = () => {
    cy?.fit(undefined, 40);
  };

  return (
    <div class="h-dvh flex flex-col">
      <header class="flex items-center justify-between px-8 py-5 border-b border-divider">
        <div>
          <h1 class="font-heading font-semibold text-text-primary text-2xl mb-0.5">Graph</h1>
          <p class="text-text-secondary text-sm">
            <Show when={data()} fallback="Loading…">
              {(d) => (
                <>
                  {d().nodes.length} nodes · {d().edges.length} edges · click node to inspect
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
          Fit
        </button>
      </header>

      <div class="flex-1 relative bg-ink">
        <Show when={data.error}>
          <div class="absolute inset-0 flex items-center justify-center text-destructive text-sm font-mono">
            Error loading graph: {String(data.error)}
          </div>
        </Show>
        <div ref={containerRef} class="absolute inset-0" />
      </div>
    </div>
  );
}
