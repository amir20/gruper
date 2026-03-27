// src/popup.ts
//
// Orchestrates everything:
//   1. Connects to the service worker WebLLM engine
//   2. Queries open tabs
//   3. Sends tab list to the model → gets JSON groupings
//   4. Applies groups via chrome.tabGroups API

import {
  CreateServiceWorkerMLCEngine,
  type ServiceWorkerMLCEngine,
} from "@mlc-ai/web-llm";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type StatusState = "loading" | "ready" | "error" | "working";

type TabGroupColor =
  | "grey" | "blue" | "red" | "yellow" | "green"
  | "pink" | "purple" | "cyan" | "orange";

interface TabGroup {
  name: string;
  color: TabGroupColor;
  tabIds: number[];
}

interface GroupingResponse {
  groups: TabGroup[];
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "Phi-3.5-mini-instruct-q4f16_1-MLC";

const GROUPING_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:   { type: "string" },
          color:  {
            type: "string",
            enum: ["grey","blue","red","yellow","green","pink","purple","cyan","orange"],
          },
          tabIds: { type: "array", items: { type: "integer" } },
        },
        required: ["name", "color", "tabIds"],
      },
    },
  },
  required: ["groups"],
} as const;

const SYSTEM_PROMPT = `You are a browser tab organizer. You MUST group tabs into MULTIPLE groups by topic.

Rules:
- Create between 2 and 8 groups based on tab topics
- NEVER put all tabs in one group — always split by topic
- Group names must be short (2-4 words max)
- Every tab must belong to exactly one group
- Use a different color for each group
- Group by domain AND topic similarity (e.g. two YouTube tabs about different topics may go in different groups)
- Return ONLY valid JSON

Example: if tabs include GitHub, Amazon, YouTube, Gmail, the result should have separate groups like "Dev Tools", "Shopping", "Entertainment", "Email" — NOT one big group.`;

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

let engine: ServiceWorkerMLCEngine | null = null;

async function getModel(): Promise<string> {
  const stored = await chrome.storage.local.get("model");
  return (stored.model as string) || DEFAULT_MODEL;
}

async function initEngine(): Promise<void> {
  const model = await getModel();
  $badge.textContent = model.split("-").slice(0, 3).join("-").toLowerCase();

  setStatus("loading", "Loading model…");
  setButtonState(false);

  engine = await CreateServiceWorkerMLCEngine(model, {
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
// Tab utilities
// ─────────────────────────────────────────────────────────────

async function getCurrentTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
}

function formatTabsForPrompt(tabs: chrome.tabs.Tab[]): string {
  return tabs
    .map((t) => `id:${t.id} title:"${sanitize(t.title)}" url:"${sanitize(t.url)}"`)
    .join("\n");
}

function sanitize(str = ""): string {
  return str.replace(/["'\n\r]/g, " ").slice(0, 120);
}

// ─────────────────────────────────────────────────────────────
// AI grouping
// ─────────────────────────────────────────────────────────────

async function getGroupingsFromModel(tabs: chrome.tabs.Tab[], retried = false): Promise<TabGroup[]> {
  if (!engine) throw new Error("Engine not initialized");

  const tabList = formatTabsForPrompt(tabs);

  let reply;
  try {
    reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: `Here are my open tabs:\n${tabList}\n\nGroup them:` },
      ],
      response_format: {
        type: "json_object",
        schema: JSON.stringify(GROUPING_SCHEMA),
      },
      temperature: 0.1,
      max_tokens: 1024,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!retried && message.includes("Model not loaded")) {
      console.warn("[TabGrouperAI] Engine lost, reloading…");
      setStatus("loading", "Reconnecting to model…");
      await initEngine();
      return getGroupingsFromModel(tabs, true);
    }
    throw err;
  }

  const raw = reply.choices[0].message.content ?? "";
  const parsed = JSON.parse(raw) as GroupingResponse;

  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    throw new Error("Model returned unexpected JSON shape");
  }

  return parsed.groups;
}

// ─────────────────────────────────────────────────────────────
// Apply Chrome tab groups
// ─────────────────────────────────────────────────────────────

async function applyGroups(groups: TabGroup[], allTabs: chrome.tabs.Tab[]): Promise<TabGroup[]> {
  const validTabIds = new Set(allTabs.map((t) => t.id).filter((id): id is number => id !== undefined));
  const applied: TabGroup[] = [];

  for (const group of groups) {
    const ids = (group.tabIds || []).filter((id) => validTabIds.has(id));
    if (ids.length === 0) continue;

    const groupId = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] });
    await chrome.tabGroups.update(groupId, {
      title: group.name,
      color: group.color,
      collapsed: false,
    });

    applied.push({ ...group, tabIds: ids });
  }

  return applied;
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

const AVAILABLE_MODELS = [
  "Phi-3.5-mini-instruct-q4f16_1-MLC",
  "Llama-3.1-8B-Instruct-q4f32_1-MLC",
];

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
    console.error("[TabGrouperAI] init failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    setStatus("error", "Failed to load model");
    showError(`Model init failed: ${message}\n\n${stack}`);
  }
})();
