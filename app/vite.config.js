import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Two pages: the app, and the clip the recorder photographs.
    rollupOptions: { input: { main: page("index.html"), clip: page("clip.html") } },
  },
  // `npm run dev` serves the UI on 5173 with hot reload and forwards the API to
  // `arena serve` on 8000, so the frontend can be iterated on without a rebuild.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  // jsdom so the rendered leaderboard table is testable, not just the pure
  // row-building rules behind it.
  test: { environment: "jsdom" },
});
