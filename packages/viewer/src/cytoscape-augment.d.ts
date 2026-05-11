import "cytoscape";

declare module "cytoscape" {
  namespace Css {
    interface Node {
      "shadow-opacity"?: number | ((ele: NodeSingular) => number);
      "shadow-blur"?: number | ((ele: NodeSingular) => number);
      "shadow-color"?: string | ((ele: NodeSingular) => string);
      "shadow-offset-x"?: number | ((ele: NodeSingular) => number);
      "shadow-offset-y"?: number | ((ele: NodeSingular) => number);
    }
    interface Edge {
      "shadow-opacity"?: number | ((ele: EdgeSingular) => number);
      "shadow-blur"?: number | ((ele: EdgeSingular) => number);
      "shadow-color"?: string | ((ele: EdgeSingular) => string);
    }
  }
}
