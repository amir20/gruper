// src/service-worker.ts
//
// Hosts the WebLLM inference engine and handles the keyboard shortcut
// to trigger tab grouping directly without the popup.

import {
  MLCEngine,
  ExtensionServiceWorkerMLCEngineHandler,
} from "@mlc-ai/web-llm";
import {
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  formatTabsForPrompt,
  getCurrentTabs,
  applyGroups,
  extractJson,
} from "./config";

// Shared engine instance — used by both the handler (popup) and shortcut
const engine = new MLCEngine();
let handler: ExtensionServiceWorkerMLCEngineHandler | undefined;

chrome.runtime.onConnect.addListener((port) => {
  if (handler === undefined) {
    handler = new ExtensionServiceWorkerMLCEngineHandler(port);
    handler.engine = engine;
  } else {
    handler.setPort(port);
  }
  port.onMessage.addListener(handler.onmessage.bind(handler));
});

// ─────────────────────────────────────────────────────────────
// Model loading
// ─────────────────────────────────────────────────────────────

let modelLoaded = false;
let modelLoading: Promise<void> | null = null;

async function getModel(): Promise<string> {
  const stored = await chrome.storage.local.get("model");
  return (stored.model as string) || DEFAULT_MODEL;
}

async function ensureModelLoaded(): Promise<void> {
  if (modelLoaded) return;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    const model = await getModel();
    console.log("[TabGrouperAI] Loading model:", model);
    setBadge("…", "#6366f1");
    await engine.reload(model);
    modelLoaded = true;
    modelLoading = null;
    console.log("[TabGrouperAI] Model loaded");
  })();

  return modelLoading;
}

// Track when popup loads a model through the handler
const origReload = engine.reload.bind(engine);
engine.reload = async (...args: Parameters<typeof engine.reload>) => {
  const result = await origReload(...args);
  modelLoaded = true;
  return result;
};

// ─────────────────────────────────────────────────────────────
// Badge helpers
// ─────────────────────────────────────────────────────────────

function setBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

let spinnerInterval: ReturnType<typeof setInterval> | null = null;
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner() {
  let i = 0;
  setBadge(spinnerFrames[0], "#6366f1");
  spinnerInterval = setInterval(() => {
    i = (i + 1) % spinnerFrames.length;
    setBadge(spinnerFrames[i], "#6366f1");
  }, 120);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Keyboard shortcut handler (Alt+Shift+G)
// ─────────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "group-tabs") return;

  startSpinner();

  try {
    await ensureModelLoaded();

    const tabs = await getCurrentTabs();
    console.log("[TabGrouperAI] Shortcut: found", tabs.length, "ungrouped tabs");
    if (tabs.length === 0) {
      stopSpinner();
      clearBadge();
      return;
    }

    const tabList = formatTabsForPrompt(tabs);
    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Here are my open tabs:\n${tabList}\n\nGroup them:` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const raw = reply.choices[0].message.content ?? "";
    console.log("[TabGrouperAI] Model response:", raw);

    const parsed = extractJson(raw);
    const applied = await applyGroups(parsed.groups, tabs);

    stopSpinner();
    console.log("[TabGrouperAI] Applied", applied.length, "of", parsed.groups.length, "groups");

    if (applied.length > 0) {
      setBadge("✓", "#22c55e");
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Tab Grouper AI",
        message: `Grouped ${tabs.length} tabs into ${applied.length} groups.`,
      });
    } else {
      setBadge("!", "#f59e0b");
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Tab Grouper AI",
        message: "Model returned groups but no tab IDs matched. See service worker console.",
      });
    }
  } catch (err) {
    console.error("[TabGrouperAI] Shortcut grouping failed:", err);
    stopSpinner();
    setBadge("!", "#ef4444");
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "Tab Grouper AI",
      message: `Grouping failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  setTimeout(clearBadge, 3000);
});
