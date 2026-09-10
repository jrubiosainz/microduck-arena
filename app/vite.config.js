import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  // `npm run dev` serves the UI on 5173 with hot reload and forwards the API to
  // `arena serve` on 8000, so the frontend can be iterated on without a rebuild.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  // jsdom so the rendered leaderboard table is testable, not just the pure
  // row-building rules behind it.
  test: { environment: "jsdom" },
});
