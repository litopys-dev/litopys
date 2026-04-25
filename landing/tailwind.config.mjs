/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts,md}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        surface: "#131316",
        elevated: "#1a1a1f",
        border: "#2a2a31",
        divider: "#1f1f25",
        accent: "#7dd3fc",
        "accent-muted": "#38bdf8",
        "text-primary": "#f5f5f7",
        "text-secondary": "#b4b4be",
        "text-tertiary": "#71717a",
        chip: {
          person: "#f87171",
          project: "#4ade80",
          system: "#fbbf24",
          concept: "#c084fc",
          event: "#22d3ee",
          lesson: "#34d399",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
        heading: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "10px",
      },
      maxWidth: {
        prose: "72ch",
      },
    },
  },
};
