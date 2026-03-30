import { defineBackground } from "wxt/utils/define-background";
import {
  MLCEngine,
  ExtensionServiceWorkerMLCEngineHandler,
} from "@mlc-ai/web-llm";
import {
  SYSTEM_PROMPT,
  buildTabPrompt,
  remapTabIds,
  getCurrentTabs,
  applyGroups,
  extractJson,
  getProviderConfig,
  toMessage,
} from "@/utils/config";
import { chatCompletion } from "@/utils/openrouter";

export default defineBackground({
  type: "module",

  main() {
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

    function getEngine(): MLCEngine | undefined {
      return handler?.engine;
    }

    function isModelLoaded(): boolean {
      return !!(handler?.modelId && handler.modelId.length > 0);
    }

    async function ensureModelLoaded(): Promise<void> {
      if (isModelLoaded()) return;

      if (!handler) {
        throw new Error("Model not loaded — open the extension popup to download the model first.");
      }

      const config = await getProviderConfig();
      console.log("[Gruper] Loading model from shortcut:", config.model);
      setBadge("…", "#6366f1");
      await handler.engine.reload(config.model);
      handler.modelId = [config.model];
      console.log("[Gruper] Model loaded");
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
        const config = await getProviderConfig();
        const tabs = await getCurrentTabs();
        console.log("[Gruper] Shortcut: found", tabs.length, "ungrouped tabs");
        if (tabs.length === 0) {
          stopSpinner();
          clearBadge();
          return;
        }

        const { prompt: tabList, idMap } = buildTabPrompt(tabs);
        const messages: { role: "system" | "user"; content: string }[] = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Here are my open tabs:\n${tabList}\n\nGroup them:` },
        ];

        let raw: string;

        if (config.provider === "openrouter") {
          if (!config.openrouterApiKey) throw new Error("OpenRouter API key not set. Open the popup to configure.");
          raw = await chatCompletion(config.openrouterApiKey, config.openrouterModel, messages, {
            temperature: 0.3,
            max_tokens: 1024,
          });
        } else {
          await ensureModelLoaded();
          const engine = getEngine();
          if (!engine) throw new Error("Engine unavailable after model load");
          const reply = await engine.chat.completions.create({
            messages,
            temperature: 0.3,
            max_tokens: 1024,
          });
          raw = reply.choices[0].message.content ?? "";
        }

        console.log("[Gruper] Model response:", raw);

        const parsed = extractJson(raw);
        const remapped = remapTabIds(parsed.groups, idMap);
        const applied = await applyGroups(remapped, tabs);

        stopSpinner();
        console.log("[Gruper] Applied", applied.length, "of", parsed.groups.length, "groups");

        if (applied.length > 0) {
          setBadge("✓", "#22c55e");
          chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("/icons/icon128.png"),
            title: "Gruper",
            message: `Grouped ${tabs.length} tabs into ${applied.length} groups.`,
          });
        } else {
          setBadge("!", "#f59e0b");
          chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("/icons/icon128.png"),
            title: "Gruper",
            message: "Model returned groups but no tab IDs matched. See service worker console.",
          });
        }
      } catch (err) {
        console.error("[Gruper] Shortcut grouping failed:", err);
        stopSpinner();
        setBadge("!", "#ef4444");
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("/icons/icon128.png"),
          title: "Gruper",
          message: toMessage(err),
        });
      }

      setTimeout(clearBadge, 3000);
    });
  },
});
