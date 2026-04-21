/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark theme palette
        ink: "#0b0d10",
        surface: "#14171c",
        elevated: "#1a1e24",
        border: "#262b33",
        divider: "#1f2329",
        // Text
        "text-primary": "#e6e8eb",
        "text-secondary": "#9aa3ae",
        "text-tertiary": "#6b7280",
        // Accent
        accent: "#60a5fa",
        // Destructive
        destructive: "#f87171",
      },
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        heading: ['"Space Grotesk"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "6px",
        chip: "4px",
      },
    },
  },
  plugins: [],
};
