import { Construction } from "lucide-solid";

interface Props {
  title: string;
  phase: string;
  description: string;
}

export function ComingSoon(props: Props) {
  return (
    <div class="p-8 max-w-2xl">
      <header class="mb-6">
        <h1 class="font-heading font-semibold text-text-primary text-2xl mb-1">{props.title}</h1>
      </header>
      <div class="bg-surface border border-border rounded-card p-6 flex items-start gap-4">
        <Construction size={20} class="text-text-tertiary shrink-0 mt-0.5" />
        <div>
          <div class="text-text-primary text-sm font-medium mb-1">Coming in {props.phase}</div>
          <p class="text-text-secondary text-sm leading-relaxed">{props.description}</p>
        </div>
      </div>
    </div>
  );
}
