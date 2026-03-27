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
  },
});
