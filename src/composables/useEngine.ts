import { ref, computed } from "vue";
import {
  CreateExtensionServiceWorkerMLCEngine,
  type ExtensionServiceWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import {
  SYSTEM_PROMPT,
  buildTabPrompt,
  remapTabIds,
  extractJson,
  getModel,
  toMessage,
  type TabGroup,
} from "../config";

export type Status = "loading" | "ready" | "error" | "working";

export function useEngine() {
  let engine: ExtensionServiceWorkerMLCEngine | null = null;

  const status = ref<Status>("loading");
  const statusText = ref("Initializing...");
  const error = ref("");
  const currentModel = ref("");
  const progress = ref({ visible: false, pct: 0, label: "" });

  const modelBadge = computed(() =>
    currentModel.value.split("-").slice(0, 3).join("-").toLowerCase()
  );

  function setStatus(s: Status, text: string) {
    status.value = s;
    statusText.value = text;
  }

  function setError(msg: string) {
    error.value = msg;
    setStatus("error", "Something went wrong");
  }

  function clearError() {
    error.value = "";
  }

  async function init(): Promise<void> {
    const model = await getModel();
    currentModel.value = model;
    setStatus("loading", "Loading model...");

    if (engine) {
      try { await engine.unload(); } catch { /* ignore */ }
      engine = null;
    }

    engine = await CreateExtensionServiceWorkerMLCEngine(model, {
      initProgressCallback: ({ progress: p, text }) => {
        const pct = Math.round((p ?? 0) * 100);
        progress.value = { visible: true, pct, label: text || "Downloading model..." };
        statusText.value = `Downloading... ${pct}%`;
      },
    });

    progress.value = { visible: false, pct: 0, label: "" };
    setStatus("ready", "Model ready");
  }

  async function switchModel(model: string): Promise<void> {
    if (model === currentModel.value) return;
    await chrome.storage.local.set({ model });
    engine = null;
    await init();
  }

  async function groupTabs(tabs: chrome.tabs.Tab[], retried = false): Promise<TabGroup[]> {
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
      const msg = toMessage(err);
      if (!retried && (msg.includes("Model not loaded") || msg.includes("BindingError"))) {
        console.warn("[TabGrouperAI] Engine lost, reloading...");
        setStatus("loading", "Reconnecting to model...");
        await init();
        return groupTabs(tabs, true);
      }
      throw err;
    }

    const raw = reply.choices[0].message.content ?? "";
    return remapTabIds(extractJson(raw).groups, idMap);
  }

  async function clearGroups(): Promise<void> {
    const tabGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    for (const g of tabGroups) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      const ids = tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
      if (ids.length > 0) await chrome.tabs.ungroup(ids as [number, ...number[]]);
    }
  }

  return {
    status,
    statusText,
    error,
    currentModel,
    modelBadge,
    progress,
    setStatus,
    setError,
    clearError,
    init,
    switchModel,
    groupTabs,
    clearGroups,
  };
}
