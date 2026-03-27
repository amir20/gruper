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
  buildTabPrompt,
  remapTabIds,
  getCurrentTabs,
  applyGroups,
  extractJson,
} from "./config";

let handler: ExtensionServiceWorkerMLCEngineHandler | undefined;

chrome.runtime.onConnect.addListener((port) => {
  if (handler === undefined) {
    handler = new ExtensionServiceWorkerMLCEngineHandler(port);
  } else {
    handler.setPort(port);
  }
  port.onMessage.addListener(handler.onmessage.bind(handler));
});

// ─────────────────────────────────────────────────────────────
// Model loading
// ─────────────────────────────────────────────────────────────

async function getModel(): Promise<string> {
  const stored = await chrome.storage.local.get("model");
  return (stored.model as string) || DEFAULT_MODEL;
}

function getEngine(): MLCEngine | undefined {
  return handler?.engine;
}

function isModelLoaded(): boolean {
  return !!(handler?.modelId && handler.modelId.length > 0);
}

async function ensureModelLoaded(): Promise<void> {
  if (isModelLoaded()) return;

  // No handler yet — create a temporary engine to load the model.
  // The popup will replace it when it connects.
  if (!handler) {
    // We can't load without a handler in the extension SW architecture.
    // Notify the user to open the popup.
    throw new Error("Model not loaded — open the extension popup to download the model first.");
  }

  const model = await getModel();
  console.log("[TabGrouperAI] Loading model from shortcut:", model);
  setBadge("…", "#6366f1");
  await handler.engine.reload(model);
  handler.modelId = [model];
  console.log("[TabGrouperAI] Model loaded");
}

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
    const engine = getEngine()!;

    const tabs = await getCurrentTabs();
    console.log("[TabGrouperAI] Shortcut: found", tabs.length, "ungrouped tabs");
    if (tabs.length === 0) {
      stopSpinner();
      clearBadge();
      return;
    }

    const { prompt: tabList, idMap } = buildTabPrompt(tabs);
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
    const remapped = remapTabIds(parsed.groups, idMap);
    const applied = await applyGroups(remapped, tabs);

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
      message: `${err instanceof Error ? err.message : String(err)}`,
    });
  }

  setTimeout(clearBadge, 3000);
});
