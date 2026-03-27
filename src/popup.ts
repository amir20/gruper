// src/popup.ts
//
// Orchestrates everything:
//   1. Connects to the service worker WebLLM engine
//   2. Queries open tabs
//   3. Sends tab list to the model → gets JSON groupings
//   4. Applies groups via chrome.tabGroups API

import {
  CreateExtensionServiceWorkerMLCEngine,
  type ExtensionServiceWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import {
  DEFAULT_MODEL,
  AVAILABLE_MODELS,
  SYSTEM_PROMPT,
  buildTabPrompt,
  remapTabIds,
  getCurrentTabs,
  applyGroups,
  extractJson,
  type TabGroup,
} from "./config";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type StatusState = "loading" | "ready" | "error" | "working";

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const $dot      = document.getElementById("statusDot")!;
const $status   = document.getElementById("statusText")!;
const $progress = document.getElementById("progressWrap")!;
const $fill     = document.getElementById("progressFill") as HTMLElement;
const $progLbl  = document.getElementById("progressLabel")!;
const $tabCount = document.getElementById("tabCount")!;
const $btnGroup = document.getElementById("btnGroup") as HTMLButtonElement;
const $results  = document.getElementById("results")!;
const $list     = document.getElementById("groupList")!;
const $error    = document.getElementById("errorBox")!;
const $clear    = document.getElementById("clearBtn")!;
const $settings = document.getElementById("settingsBtn")!;
const $badge    = document.getElementById("modelBadge")!;

// ─────────────────────────────────────────────────────────────
// State helpers
// ─────────────────────────────────────────────────────────────

function setStatus(state: StatusState, text: string): void {
  $dot.className = `status-dot ${state}`;
  $status.textContent = text;
}

function showProgress(pct: number, label: string): void {
  $progress.classList.add("visible");
  $fill.style.width = `${pct}%`;
  $progLbl.textContent = label;
}

function hideProgress(): void {
  $progress.classList.remove("visible");
}

function showError(msg: string): void {
  $error.textContent = msg;
  $error.classList.add("visible");
}

function hideError(): void {
  $error.classList.remove("visible");
}

function setButtonState(enabled: boolean, label = "Group Tabs"): void {
  $btnGroup.disabled = !enabled;
  $btnGroup.textContent = label;
}

// ─────────────────────────────────────────────────────────────
// Model init
// ─────────────────────────────────────────────────────────────

let engine: ExtensionServiceWorkerMLCEngine | null = null;

async function getModel(): Promise<string> {
  const stored = await chrome.storage.local.get("model");
  return (stored.model as string) || DEFAULT_MODEL;
}

async function initEngine(): Promise<void> {
  const model = await getModel();
  $badge.textContent = model.split("-").slice(0, 3).join("-").toLowerCase();

  setStatus("loading", "Loading model…");
  setButtonState(false);

  // Fully unload previous engine to avoid WASM binding mismatches
  if (engine) {
    try { await engine.unload(); } catch { /* ignore */ }
    engine = null;
  }

  engine = await CreateExtensionServiceWorkerMLCEngine(model, {
    initProgressCallback: (progress) => {
      const pct = Math.round((progress.progress ?? 0) * 100);
      showProgress(pct, progress.text || "Downloading model…");
      setStatus("loading", `Downloading… ${pct}%`);
    },
  });

  hideProgress();
  setStatus("ready", "Model ready");
  setButtonState(true);
}


// ─────────────────────────────────────────────────────────────
// AI grouping
// ─────────────────────────────────────────────────────────────

async function getGroupingsFromModel(tabs: chrome.tabs.Tab[], retried = false): Promise<TabGroup[]> {
  if (!engine) throw new Error("Engine not initialized");

  const { prompt: tabList, idMap } = buildTabPrompt(tabs);

  let reply;
  try {
    reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Here are my open tabs:\n${tabList}\n\nGroup them:` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!retried && (message.includes("Model not loaded") || message.includes("BindingError"))) {
      console.warn("[TabGrouperAI] Engine lost or stale, reloading…");
      setStatus("loading", "Reconnecting to model…");
      await initEngine();
      return getGroupingsFromModel(tabs, true);
    }
    throw err;
  }

  const raw = reply.choices[0].message.content ?? "";
  return remapTabIds(extractJson(raw).groups, idMap);
}

// ─────────────────────────────────────────────────────────────
// Render results
// ─────────────────────────────────────────────────────────────

function renderResults(groups: TabGroup[]): void {
  $list.innerHTML = "";

  for (const g of groups) {
    const item = document.createElement("div");
    item.className = "group-item";
    item.innerHTML = `
      <div class="group-color color-${g.color}"></div>
      <span class="group-name">${escapeHtml(g.name)}</span>
      <span class="group-count">${g.tabIds.length} tab${g.tabIds.length !== 1 ? "s" : ""}</span>
    `;
    $list.appendChild(item);
  }

  $results.classList.add("visible");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────────────────────

async function doGroupTabs(): Promise<void> {
  hideError();
  $results.classList.remove("visible");
  setStatus("working", "Analyzing tabs…");
  setButtonState(false, "Working…");

  try {
    const tabs = await getCurrentTabs();
    setStatus("working", `Grouping ${tabs.length} tabs…`);

    const groups  = await getGroupingsFromModel(tabs);
    const applied = await applyGroups(groups, tabs);

    renderResults(applied);
    setStatus("ready", `Done — ${applied.length} groups created`);
    setButtonState(true);
  } catch (err) {
    console.error("[TabGrouperAI]", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    showError(`Error: ${message}`);
    setStatus("error", "Something went wrong");
    setButtonState(true);
  }
}

// ─────────────────────────────────────────────────────────────
// Clear groups
// ─────────────────────────────────────────────────────────────

async function clearGroups(): Promise<void> {
  try {
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    for (const g of groups) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      const ids = tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
      if (ids.length > 0) await chrome.tabs.ungroup(ids as [number, ...number[]]);
    }
    $results.classList.remove("visible");
    setStatus("ready", "Groups cleared");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showError(`Could not clear groups: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Settings (simple model picker via prompt)
// ─────────────────────────────────────────────────────────────

async function openSettings(): Promise<void> {
  const current = await getModel();
  const list = AVAILABLE_MODELS.map((m, i) => `${i + 1}. ${m}${m === current ? " ✓" : ""}`).join("\n");
  const choice = prompt(`Choose model (enter number):\n\n${list}\n\n⚠ Changing model triggers a new download.`);
  const idx = parseInt(choice ?? "", 10) - 1;

  if (idx >= 0 && idx < AVAILABLE_MODELS.length && AVAILABLE_MODELS[idx] !== current) {
    await chrome.storage.local.set({ model: AVAILABLE_MODELS[idx] });
    engine = null;
    await initEngine();
  }
}

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────

(async () => {
  const tabs = await getCurrentTabs();
  $tabCount.innerHTML = `<span>${tabs.length}</span> tabs in this window`;

  $btnGroup.addEventListener("click", doGroupTabs);
  $clear.addEventListener("click", clearGroups);
  $settings.addEventListener("click", openSettings);

  try {
    await initEngine();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unload")) {
      console.warn("[TabGrouperAI] Engine unloaded during init, retrying…");
      try {
        engine = null;
        await initEngine();
      } catch (retryErr) {
        console.error("[TabGrouperAI] retry failed:", retryErr);
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        setStatus("error", "Failed to load model");
        showError(`Model init failed: ${retryMsg}`);
      }
    } else {
      console.error("[TabGrouperAI] init failed:", err);
      const stack = err instanceof Error ? err.stack ?? "" : "";
      setStatus("error", "Failed to load model");
      showError(`Model init failed: ${message}\n\n${stack}`);
    }
  }
})();
