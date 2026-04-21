import { A, useLocation } from "@solidjs/router";
import { GitGraph, GitMerge, LayoutDashboard, ShieldAlert, Table2 } from "lucide-solid";
import { For, type ParentProps, Suspense } from "solid-js";

interface NavItem {
  href: string;
  label: string;
  icon: () => import("solid-js").JSX.Element;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: () => <LayoutDashboard size={16} />, exact: true },
  { href: "/table", label: "Nodes", icon: () => <Table2 size={16} /> },
  { href: "/graph", label: "Graph", icon: () => <GitGraph size={16} /> },
  { href: "/quarantine", label: "Quarantine", icon: () => <ShieldAlert size={16} /> },
  { href: "/conflicts", label: "Conflicts", icon: () => <GitMerge size={16} /> },
];

function NavLink(props: NavItem) {
  const location = useLocation();
  const isActive = () =>
    props.exact ? location.pathname === props.href : location.pathname.startsWith(props.href);

  return (
    <A
      href={props.href}
      class="flex items-center gap-3 px-3 py-2 rounded-card text-sm font-medium transition-colors duration-150 outline-none"
      classList={{
        "bg-accent/10 text-accent": isActive(),
        "text-text-secondary hover:text-text-primary hover:bg-elevated": !isActive(),
      }}
      aria-current={isActive() ? "page" : undefined}
    >
      <span class="opacity-90">{props.icon()}</span>
      <span>{props.label}</span>
    </A>
  );
}

export function Layout(props: ParentProps) {
  return (
    <div class="flex min-h-dvh">
      {/* Sidebar */}
      <nav
        class="fixed left-0 top-0 bottom-0 w-52 bg-surface border-r border-border flex flex-col z-20"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div class="px-4 py-5 border-b border-divider">
          <span class="font-heading font-semibold text-text-primary text-base tracking-tight">
            Litopys
          </span>
          <span class="ml-2 font-mono text-xs text-text-tertiary">dashboard</span>
        </div>

        {/* Nav items */}
        <div class="flex-1 px-3 py-4 flex flex-col gap-1">
          <For each={NAV_ITEMS}>{(item) => <NavLink {...item} />}</For>
        </div>

        {/* Footer */}
        <div class="px-4 py-3 border-t border-divider">
          <span class="font-mono text-xs text-text-tertiary">localhost:3999</span>
        </div>
      </nav>

      {/* Main content */}
      <main class="flex-1 ml-52 min-h-dvh">
        <Suspense fallback={<div class="p-8 text-text-secondary text-sm">Loading...</div>}>
          {props.children}
        </Suspense>
      </main>
    </div>
  );
}
