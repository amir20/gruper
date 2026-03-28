# Tab Grouper AI

A Chrome extension that automatically groups your open tabs using an **in-browser LLM** — no server, no API key, no Ollama. The model runs entirely on your GPU via WebGPU.

## How it works

```
popup.js  ──── chrome.tabs.query() ──→  your open tabs
    │
    └── WebLLM (ServiceWorkerMLCEngine) ──→  Llama 3.2 1B (in-browser)
                                                    │
                                              JSON groupings
                                                    │
    └── chrome.tabGroups API  ──────────────→  groups applied
```

The model lives in the **service worker**, so it stays warm between popup opens.

## Browser Compatibility

| Browser | Status | Notes |
|---------|--------|-------|
| Chrome 113+ | Supported | Fully tested |
| Dia | Supported | Fully tested |
| Arc | Not supported | Arc does not implement the `chrome.tabGroups` API |

Other Chromium-based browsers may work if they support the `chrome.tabGroups` API and WebGPU.

## Requirements

- A supported Chromium-based browser (see above)
- WebGPU support
- ~1GB free RAM/VRAM for the default model
- Node.js 18+

## Setup

```bash
npm install
npm run build
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

## First run

On first use, the model (~700MB) downloads from HuggingFace and caches in your browser. This takes 1–2 minutes on a fast connection. Subsequent loads are instant.

## Models

| Model | Size | Quality |
|-------|------|---------|
| `Llama-3.2-1B-Instruct-q4f32_1-MV` | ~700MB | Fast, good enough |
| `Phi-3.5-mini-instruct-q4f16_1-MV` | ~2.2GB | Smarter groupings |
| `Llama-3.1-8B-Instruct-q4f32_1-MV` | ~4.5GB | Best quality |

Switch models via the ⚙ icon in the popup.

## Development

```bash
npm run dev   # watch mode — rebuilds on file changes
```

Reload the extension in `chrome://extensions` after each build.

## Icons

Add your icons to an `icons/` folder in the project root before building:
- `icons/icon16.png`
- `icons/icon48.png`  
- `icons/icon128.png`

Or remove the `default_icon` field from `manifest.json` to skip icons during dev.

## Extending

### Add Ollama fallback

In `popup.js`, check for Ollama availability before initializing WebLLM:

```js
async function checkOllama() {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    return res.ok;
  } catch { return false; }
}
```

If available, use the Ollama OpenAI-compatible endpoint instead of `CreateServiceWorkerMLCEngine`.

### Custom grouping rules

Edit the `SYSTEM_PROMPT` in `popup.js` to tune how tabs get grouped — e.g. "always keep GitHub tabs in one group" or "separate work from personal".
