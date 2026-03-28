<p align="center">
  <img src="logo.svg" alt="Tab Grouper AI" width="128" height="128">
</p>

<h1 align="center">Tab Grouper AI</h1>

<p align="center">
  A browser extension that automatically groups your open tabs using AI.<br>
  Run a local LLM entirely on your GPU — or use a cloud provider. No server, no Ollama.
</p>

---

## How It Works

1. **Reads your open tabs** — title and URL of every ungrouped, unpinned tab in your current window.
2. **Sends them to an LLM** — either a local model running in-browser via [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU, or a cloud model via [OpenRouter](https://openrouter.ai).
3. **Groups them by topic** — the model returns JSON with group names, colors, and tab assignments.
4. **Applies Chrome tab groups** — each group gets a name and color using the `chrome.tabGroups` API.

```
┌─────────────────┐       ┌──────────────────────────┐       ┌──────────────┐
│  Your open tabs  │──────▶│  LLM (local or cloud)    │──────▶│  Tab groups  │
│  (ungrouped)     │       │  "Group these by topic"   │       │  applied     │
└─────────────────┘       └──────────────────────────┘       └──────────────┘
```

The local model runs inside the **service worker**, so it stays loaded between popup opens. No re-download, no cold starts.

### Keyboard Shortcut

Press **Alt+Shift+G** to group tabs instantly without opening the popup.

## Browser Compatibility

| Browser | Status | Notes |
|---------|--------|-------|
| Chrome 113+ | Supported | Fully tested |
| Brave | Supported | Fully tested |
| Dia | Supported | Fully tested |
| Arc | Not supported | Arc does not implement the `chrome.tabGroups` API |

Other Chromium-based browsers may work if they support the `chrome.tabGroups` API and WebGPU.

## Models

### Local (WebLLM)

Models run entirely in your browser via WebGPU. Downloaded once from HuggingFace and cached locally.

| Model | Notes |
|-------|-------|
| **Qwen2.5-7B-Instruct** (default) | Best balance of quality and speed |
| Llama-3.1-8B-Instruct | Strong general-purpose model |
| Qwen2.5-3B-Instruct | Lighter, faster on modest GPUs |
| Qwen2.5-1.5B-Instruct | Smallest and fastest |

All models are 4-bit quantized (q4f16_1) for efficient GPU inference.

### Cloud (OpenRouter)

Bring your own [OpenRouter](https://openrouter.ai) API key to use cloud models. Popular options include:

| Model | Provider |
|-------|----------|
| **Gemini 2.5 Flash** (default) | Google |
| Claude Sonnet 4 | Anthropic |
| GPT-4.1 Mini | OpenAI |
| Llama 4 Maverick | Meta |
| DeepSeek Chat v3 | DeepSeek |

You can also enter any model ID available on OpenRouter.

## Requirements

- A supported Chromium-based browser (see above)
- WebGPU support (for local models)
- ~1 GB free VRAM for the default local model
- Node.js 18+ (for building from source)

## Setup

```bash
npm install
npm run build
```

Then load the extension:
1. Go to `chrome://extensions` (or your browser's equivalent)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

## First Run

On first use with a local model, the weights download from HuggingFace and cache in your browser. The default model is ~5 GB. Subsequent loads are instant.

To skip the download, switch to **OpenRouter** in the model settings and provide an API key.

## Development

```bash
npm run dev   # watch mode — rebuilds on file changes
```

Reload the extension in `chrome://extensions` after each rebuild.

## Customization

Edit `src/system-prompt.txt` to change how tabs get grouped. For example:
- "Always keep GitHub tabs in one group"
- "Separate work from personal"
- "Create a group called Reading for articles and blog posts"

## Roadmap

- [ ] Firefox support (Manifest V3 + `browser.tabGroups`)
- [ ] Auto-group on new tab or window change
- [ ] User-defined grouping rules in the UI (no code editing)
- [ ] Ollama / local server support
- [ ] Sync settings across devices
- [ ] Per-window grouping profiles (e.g. "work" vs "personal")
- [ ] Undo / restore previous tab arrangement
- [ ] Chrome Web Store / extension marketplace publishing

## License

MIT
