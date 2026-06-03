import { nodeTypeLabel } from "../i18n.ts";

type NodeType = "person" | "project" | "system" | "concept" | "event" | "lesson";

interface Props {
  type: NodeType;
  /** Optional display text. Defaults to the localized type label. */
  label?: string;
}

export function TypeChip(props: Props) {
  return (
    <span class={`chip chip-${props.type}`} aria-label={`Type: ${props.type}`}>
      {props.label ?? nodeTypeLabel[props.type]}
    </span>
  );
}
