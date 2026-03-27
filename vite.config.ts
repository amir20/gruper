import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  base: "",
  plugins: [webExtension()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // WebLLM uses WASM — don't try to inline it
    assetsInlineLimit: 0,
    // Suppress the large chunk warning — @mlc-ai/web-llm is ~6MB and
    // must be inlined into each entry (service worker can't use shared chunks).
    chunkSizeWarningLimit: 6000,
  },
});
