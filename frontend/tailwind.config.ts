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
          DEFAULT: "#07090d",
          soft: "#0b0f16",
          card: "#0f141c",
          elevated: "#141b26",
        },
        border: {
          DEFAULT: "#1c2431",
          strong: "#2a3444",
        },
        fg: {
          DEFAULT: "#e7ecf3",
          muted: "#8a95a6",
          subtle: "#5b6678",
        },
        brand: {
          DEFAULT: "#06b6d4",
          foreground: "#04151c",
        },
        success: "#10b981",
        danger: "#ef4444",
        warn: "#f59e0b",
      },
      boxShadow: {
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
