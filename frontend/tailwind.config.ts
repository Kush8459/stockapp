import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        bg: {
          DEFAULT: "rgb(var(--color-bg) / <alpha-value>)",
          soft: "rgb(var(--color-bg-soft) / <alpha-value>)",
          card: "rgb(var(--color-bg-card) / <alpha-value>)",
          elevated: "rgb(var(--color-bg-elevated) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          strong: "rgb(var(--color-border-strong) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--color-fg) / <alpha-value>)",
          muted: "rgb(var(--color-fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--color-fg-subtle) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--color-brand) / <alpha-value>)",
          foreground: "rgb(var(--color-brand-fg) / <alpha-value>)",
        },
        // Adaptive hover/divider overlay — white in dark mode, slate-900 in
        // light mode. Use `bg-overlay/5`, `bg-overlay/10` etc. instead of
        // raw `bg-white/N` so the same class works in both themes.
        overlay: "rgb(var(--color-overlay) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
      },
      boxShadow: {
        // The inset highlight + drop shadow are both tuned for dark; in light
        // mode the inset highlight is invisible and the drop shadow needs to
        // be softer. See `:root.light .shadow-card` override in index.css.
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 30px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(6,182,212,0.18), 0 10px 40px -12px rgba(6,182,212,0.35)",
      },
      backgroundImage: {
        "radial-fade":
          "radial-gradient(1200px 700px at 20% -10%, rgba(6,182,212,0.12), transparent 55%), radial-gradient(900px 500px at 110% 10%, rgba(139,92,246,0.10), transparent 55%)",
        grid: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
      },
      keyframes: {
        "pulse-up": {
          "0%": { boxShadow: "0 0 0 0 rgba(16,185,129,0.35)" },
          "100%": { boxShadow: "0 0 0 12px rgba(16,185,129,0)" },
        },
        "pulse-down": {
          "0%": { boxShadow: "0 0 0 0 rgba(239,68,68,0.35)" },
          "100%": { boxShadow: "0 0 0 12px rgba(239,68,68,0)" },
        },
      },
      animation: {
        "pulse-up": "pulse-up 700ms ease-out",
        "pulse-down": "pulse-down 700ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
