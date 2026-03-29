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
  getProviderConfig,
  saveProviderConfig,
  toMessage,
  type TabGroup,
  type Provider,
  type ProviderConfig,
} from "@/utils/config";
import { chatCompletion } from "@/utils/openrouter";

export type Status = "loading" | "ready" | "error" | "working";

export function useEngine() {
  let engine: ExtensionServiceWorkerMLCEngine | null = null;

  const status = ref<Status>("loading");
  const statusText = ref("Initializing...");
  const error = ref("");
  const currentModel = ref("");
  const currentProvider = ref<Provider>("local");
  const progress = ref({ visible: false, pct: 0, label: "" });

  const modelBadge = computed(() => {
    if (currentProvider.value === "openrouter") {
      // Show last segment: "google/gemini-2.5-flash" → "gemini-2.5-flash"
      return currentModel.value.split("/").pop() || currentModel.value;
    }
    return currentModel.value.split("-").slice(0, 3).join("-").toLowerCase();
  });

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
    const config = await getProviderConfig();
    currentProvider.value = config.provider;

    if (config.provider === "openrouter") {
      currentModel.value = config.openrouterModel;
      if (!config.openrouterApiKey) {
        setError("OpenRouter API key not set. Click Model to configure.");
        return;
      }
      setStatus("ready", "OpenRouter ready");
      return;
    }

    // Local WebLLM
    currentModel.value = config.model;
    setStatus("loading", "Loading model...");

    if (engine) {
      try { await engine.unload(); } catch { /* ignore */ }
      engine = null;
    }

    try {
      engine = await CreateExtensionServiceWorkerMLCEngine(config.model, {
        initProgressCallback: ({ progress: p, text }) => {
          const pct = Math.round((p ?? 0) * 100);
          progress.value = { visible: true, pct, label: text || "Downloading model..." };
          statusText.value = `Downloading... ${pct}%`;
        },
      });

      progress.value = { visible: false, pct: 0, label: "" };
      setStatus("ready", "Model ready");
    } catch (err) {
      progress.value = { visible: false, pct: 0, label: "" };
      setError("Local AI unavailable in this browser. Switch to OpenRouter for cloud-based grouping.");
    }
  }

  async function applyConfig(config: Partial<ProviderConfig>): Promise<void> {
    await saveProviderConfig(config);
    engine = null;
    await init();
  }

  async function groupTabs(tabs: chrome.tabs.Tab[], retried = false): Promise<TabGroup[]> {
    const { prompt: tabList, idMap } = buildTabPrompt(tabs);
    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Here are my open tabs:\n${tabList}\n\nGroup them:` },
    ];

    let raw: string;

    if (currentProvider.value === "openrouter") {
      const config = await getProviderConfig();
      if (!config.openrouterApiKey) throw new Error("OpenRouter API key not configured");
      raw = await chatCompletion(config.openrouterApiKey, config.openrouterModel, messages, {
        temperature: 0.3,
        max_tokens: 1024,
      });
    } else {
      if (!engine) throw new Error("Engine not initialized");
      let reply;
      try {
        reply = await engine.chat.completions.create({
          messages,
          temperature: 0.3,
          max_tokens: 1024,
        });
      } catch (err) {
        const msg = toMessage(err);
        if (!retried && (msg.includes("Model not loaded") || msg.includes("BindingError"))) {
          console.warn("[Gruper] Engine lost, reloading...");
          setStatus("loading", "Reconnecting to model...");
          await init();
          return groupTabs(tabs, true);
        }
        throw err;
      }
      raw = reply.choices[0].message.content ?? "";
    }

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
    currentProvider,
    modelBadge,
    progress,
    setStatus,
    setError,
    clearError,
    init,
    applyConfig,
    groupTabs,
    clearGroups,
  };
}
