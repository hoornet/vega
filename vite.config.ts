import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Pre-bundle Tauri API modules so Vite never triggers a full-reload
  // mid-session when it detects a "new" dependency.
  optimizeDeps: {
    include: ["@tauri-apps/api/path"],
  },

  build: {
    rollupOptions: {
      output: {
        // Vite 8 / Rolldown requires manualChunks as a function (the object
        // form is no longer accepted). Same intent as before:
        manualChunks(id: string) {
          // NDK is the largest dependency (~300kB) — split it out so the
          // main bundle parses faster at startup and the chunk can be cached.
          if (id.includes("node_modules/@nostr-dev-kit/ndk")) return "ndk";
          // React runtime — stable across releases, cache-friendly.
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
