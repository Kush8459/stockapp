import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    // Raise the "big chunk" warning threshold to a sane level — the biggest
    // chunk after splitting is recharts at ~400 kB uncompressed, which is
    // fine for a dashboard but trips the default 500 kB warning.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy libraries into their own chunks so the main entry is
        // small and the browser can cache them independently across deploys.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-tanstack": ["@tanstack/react-query", "@tanstack/react-table"],
          "vendor-recharts": ["recharts"],
          "vendor-lightweight": ["lightweight-charts"],
          "vendor-motion": ["framer-motion"],
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
          ],
          "vendor-icons": ["lucide-react"],
        },
      },
    },
  },
});
