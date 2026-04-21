type NodeType = "person" | "project" | "system" | "concept" | "event" | "lesson";

interface Props {
  type: NodeType;
}

export function TypeChip(props: Props) {
  return (
    <span class={`chip chip-${props.type}`} aria-label={`Type: ${props.type}`}>
      {props.type}
    </span>
  );
}
