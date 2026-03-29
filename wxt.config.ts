import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  imports: false,
  manifest: {
    name: "Gruper",
    version: "0.1.0",
    description:
      "Automatically group your tabs using a local AI model — no server required.",
    permissions: ["tabs", "tabGroups", "storage", "notifications"],
    host_permissions: [
      "https://huggingface.co/*",
      "https://*.huggingface.co/*",
      "https://openrouter.ai/*",
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    commands: {
      "group-tabs": {
        suggested_key: {
          default: "Alt+Shift+G",
          mac: "Alt+Shift+G",
        },
        description: "Group tabs with AI",
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      // WebLLM uses WASM — don't try to inline it
      assetsInlineLimit: 0,
      // @mlc-ai/web-llm is ~6MB, must be inlined (service worker can't use shared chunks)
      chunkSizeWarningLimit: 6000,
    },
  }),
});
