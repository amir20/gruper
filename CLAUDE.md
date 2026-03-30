# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm install          # Install dependencies (pnpm 10.33+)
pnpm build            # Chrome production build → .output/chrome-mv3/
pnpm dev              # Chrome dev mode with HMR
pnpm typecheck        # TypeScript validation (tsc --noEmit)
pnpm zip              # Build + zip for Chrome
```

After building, load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions` (Developer mode).

No linter or test framework is configured.

## Architecture

This is a Manifest V3 browser extension (Vue 3 + TypeScript + Tailwind v4) that uses an LLM to group browser tabs by topic.

### Two entry points

- **Background** (`entrypoints/background.ts`) — Hosts the WebLLM engine, handles keyboard shortcut (Alt+Shift+G), and manages Chrome port connections. Wrapped in WXT's `defineBackground()`.
- **Popup** (`entrypoints/popup/main.ts` → `entrypoints/popup/App.vue`) — Vue 3 app for the UI. Communicates with the service worker via `chrome.runtime.connect()` port messaging.

### Core flow

1. `getCurrentTabs()` in `utils/config.ts` queries ungrouped, unpinned tabs from the current window
2. `buildTabPrompt()` in `utils/config.ts` maps Chrome's large tab IDs to short sequential IDs (1, 2, 3…) and formats them for the LLM
3. The LLM (local or cloud) receives the tab list + system prompt (`assets/system-prompt.txt`) and returns JSON groupings
4. `extractJson()` in `utils/config.ts` parses the response, handling common LLM JSON mistakes (markdown fences, unquoted keys, missing wrapper)
5. `remapTabIds()` converts short IDs back to real Chrome tab IDs
6. `applyGroups()` in `utils/config.ts` calls `chrome.tabs.group()` and `chrome.tabGroups.update()` to create named, colored groups

### Two LLM providers

- **Local (WebLLM)** — `@mlc-ai/web-llm` runs quantized models on GPU via WebGPU inside the service worker. The popup creates an engine connection via `CreateExtensionServiceWorkerMLCEngine`. The `ExtensionServiceWorkerMLCEngineHandler` in the service worker relays messages.
- **Cloud (OpenRouter)** — `utils/openrouter.ts` makes direct HTTP calls to OpenRouter's OpenAI-compatible endpoint. Requires user-provided API key stored in `chrome.storage.local`.

### Key composable

`composables/useEngine.ts` — Reactive Vue composable that manages engine lifecycle, provider switching, model loading progress, tab grouping calls, and error state. This is the main orchestrator used by the popup UI.

### Config & storage

Provider choice, model ID, and OpenRouter API key are persisted in `chrome.storage.local`. Config read/write helpers are in `utils/config.ts`.

## Important constraints

- The `chrome.tabGroups` API is required — this extension does not work in Arc browser or other browsers that don't implement it.
- WebLLM bundles ~6MB into the service worker chunk (can't use shared chunks in service workers). The `chunkSizeWarningLimit` in vite.config.ts suppresses this warning.
- WASM assets must not be inlined (`assetsInlineLimit: 0` in vite.config.ts) for WebLLM to work.
- The CSP in manifest.json requires `wasm-unsafe-eval` for WebGPU/WASM inference.
