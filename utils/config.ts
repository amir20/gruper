// utils/config.ts
//
// Shared constants used by both popup and service worker.



export type TabGroupColor =
  | "grey" | "blue" | "red" | "yellow" | "green"
  | "pink" | "purple" | "cyan" | "orange";

export interface TabGroup {
  name: string;
  color: TabGroupColor;
  tabIds: number[];
}

export interface GroupingResponse {
  groups: TabGroup[];
}

export type Provider = "local" | "openrouter";

export interface ProviderConfig {
  provider: Provider;
  model: string;
  openrouterApiKey: string;
  openrouterModel: string;
  /** URL substrings (case-insensitive). Tabs whose URL matches any entry are excluded from grouping. */
  blacklist: string[];
}

export const DEFAULT_MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

export interface ModelOption {
  id: string;
  tag?: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", tag: "fastest" },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", tag: "higher quality" },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" },
];

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.8-flash";

export const POPULAR_OPENROUTER_MODELS = [
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6-luna",
  "deepseek/deepseek-v4.1-flash",
  "qwen/qwen3.8-flash",
  "google/gemma-4-31b-it:free",
];

export { default as SYSTEM_PROMPT } from "@/assets/system-prompt.txt?raw";

export async function getProviderConfig(): Promise<ProviderConfig> {
  const stored = await chrome.storage.local.get([
    "provider", "model", "openrouterApiKey", "openrouterModel", "blacklist",
  ]);
  return {
    provider: (stored.provider as Provider) || "local",
    model: (stored.model as string) || DEFAULT_MODEL,
    openrouterApiKey: (stored.openrouterApiKey as string) || "",
    openrouterModel: (stored.openrouterModel as string) || DEFAULT_OPENROUTER_MODEL,
    blacklist: Array.isArray(stored.blacklist) ? (stored.blacklist as string[]) : [],
  };
}

/**
 * True if the tab's URL matches any blacklist entry (case-insensitive substring).
 */
export function isBlacklisted(url: string | undefined, blacklist: string[]): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return blacklist.some((p) => {
    const pat = p.trim().toLowerCase();
    return pat.length > 0 && lower.includes(pat);
  });
}

export async function saveProviderConfig(config: Partial<ProviderConfig>): Promise<void> {
  await chrome.storage.local.set(config);
}

export async function getModel(): Promise<string> {
  const stored = await chrome.storage.local.get("model");
  return (stored.model as string) || DEFAULT_MODEL;
}

export function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sanitize(str = ""): string {
  return str.replace(/["'\n\r]/g, " ").slice(0, 120);
}

/**
 * Build a prompt using short sequential IDs (1, 2, 3…) instead of Chrome's
 * 9-digit IDs. Returns the prompt string and a map to convert back.
 */
export function buildTabPrompt(tabs: chrome.tabs.Tab[]): { prompt: string; idMap: Map<number, number> } {
  const idMap = new Map<number, number>(); // short → real
  const lines: string[] = [];
  let shortId = 0;
  for (const t of tabs) {
    if (t.id == null) continue;
    shortId += 1;
    idMap.set(shortId, t.id);
    lines.push(`id:${shortId} title:"${sanitize(t.title)}" url:"${sanitize(t.url)}"`);
  }
  return { prompt: lines.join("\n"), idMap };
}

/**
 * Remap short IDs in parsed groups back to real Chrome tab IDs.
 */
export function remapTabIds(groups: TabGroup[], idMap: Map<number, number>): TabGroup[] {
  return groups.map((g) => ({
    ...g,
    tabIds: g.tabIds.map((id) => idMap.get(id)).filter((id): id is number => id !== undefined),
  }));
}

export async function getCurrentTabs(): Promise<chrome.tabs.Tab[]> {
  // Find the last focused normal window — "currentWindow" from a service worker
  // context may resolve to a DevTools or popup window which can't have tab groups.
  const lastFocused = await chrome.windows.getLastFocused().catch(() => undefined);
  let windowId = lastFocused?.id;

  // If the focused window isn't a normal window, find one that is
  if (!lastFocused || lastFocused.type !== "normal" || windowId == null) {
    const allWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (allWindows.length === 0) return [];
    windowId = allWindows[0]?.id;
    if (windowId == null) return [];
  }

  const { blacklist } = await getProviderConfig();

  const allTabs = await chrome.tabs.query({ windowId });
  const filtered = allTabs.filter(
    (t) =>
      t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
      !t.pinned &&
      !isBlacklisted(t.url, blacklist),
  );
  return filtered;
}

/**
 * Extract JSON from model response — handles markdown fences, unquoted keys,
 * missing wrapper, and other common LLM JSON mistakes.
 */
export function extractJson(raw: string): GroupingResponse {
  // Strip markdown code fences
  let text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  // Find the first { and last } to extract the JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  text = text.slice(start, end + 1);

  // Fix unquoted property names (e.g. `color:` → `"color":`)
  text = text.replace(/(?<=[\{,]\s*)([a-zA-Z_]\w*)\s*:/g, '"$1":');

  // Fix unquoted string values for known fields (e.g. `"color": blue` → `"color": "blue"`)
  const colors = "grey|blue|red|yellow|green|pink|purple|cyan|orange";
  text = text.replace(new RegExp(`("color"\\s*:\\s*)(${colors})`, "g"), '$1"$2"');

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Could not parse model response as JSON");
  }

  // Handle case where model returns a single group object or array instead of {groups:[...]}
  if (Array.isArray(parsed)) {
    parsed = { groups: parsed };
  } else if (parsed && !parsed.groups && parsed.name && parsed.tabIds) {
    parsed = { groups: [parsed] };
  }

  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    throw new Error("Model returned JSON without a groups array");
  }
  return parsed as GroupingResponse;
}

const VALID_COLORS = new Set<TabGroupColor>(["blue","cyan","green","grey","orange","pink","purple","red","yellow"]);

/**
 * Reload a discarded (sleeping) tab and wait until the browser has woken it up.
 */
async function wakeTab(id: number, timeoutMs = 5000): Promise<void> {
  await chrome.tabs.reload(id);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(id);
    if (!tab.discarded && tab.status !== "unloaded") return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Group tabs one at a time. Some browsers (e.g. Dia) reject the whole
 * chrome.tabs.group call if any single tab is discarded, so this groups the
 * awake tabs first, then wakes the sleeping ones, groups them, and puts them
 * back to sleep.
 */
async function groupTabsIndividually(
  ids: number[],
  windowId: number | undefined,
  tabsById: Map<number, chrome.tabs.Tab>,
): Promise<{ groupId?: number; grouped: number[] }> {
  let groupId: number | undefined;
  const grouped: number[] = [];
  const sleeping: number[] = [];

  async function tryGroup(id: number): Promise<boolean> {
    try {
      groupId = await chrome.tabs.group(
        groupId === undefined
          ? { tabIds: id, createProperties: windowId ? { windowId } : undefined }
          : { tabIds: id, groupId },
      );
      grouped.push(id);
      return true;
    } catch (err) {
      if (tabsById.get(id)?.discarded) {
        sleeping.push(id);
      } else {
        console.warn("[Gruper] Could not group tab", tabsById.get(id)?.title, toMessage(err));
      }
      return false;
    }
  }

  for (const id of ids) await tryGroup(id);
  if (sleeping.length === 0) return { groupId, grouped };

  const toWake = sleeping.splice(0);
  await Promise.all(toWake.map((id) => wakeTab(id).catch(() => undefined)));
  for (const id of toWake) {
    if (await tryGroup(id)) {
      chrome.tabs.discard(id).catch(() => undefined);
    } else {
      console.warn("[Gruper] Could not group tab even after waking it", tabsById.get(id)?.title);
    }
  }

  return { groupId, grouped };
}

export async function applyGroups(groups: TabGroup[], allTabs: chrome.tabs.Tab[]): Promise<TabGroup[]> {
  const tabsById = new Map(allTabs.filter((t) => t.id != null).map((t) => [t.id!, t]));
  const windowId = allTabs[0]?.windowId;
  const applied: TabGroup[] = [];

  for (const group of groups) {
    const ids = (group.tabIds || []).filter((id) => tabsById.has(id));
    if (ids.length === 0) continue;

    const color: TabGroupColor = VALID_COLORS.has(group.color) ? group.color : "grey";

    let groupId: number | undefined;
    let grouped = ids;
    try {
      groupId = await chrome.tabs.group({
        tabIds: ids as [number, ...number[]],
        createProperties: windowId ? { windowId } : undefined,
      });
    } catch (err) {
      console.warn("[Gruper] Grouping failed, retrying tab by tab:", group.name, toMessage(err));
      ({ groupId, grouped } = await groupTabsIndividually(ids, windowId, tabsById));
    }
    if (groupId === undefined || grouped.length === 0) continue;

    try {
      await chrome.tabGroups.update(groupId, {
        title: group.name,
        color,
        collapsed: false,
      });
    } catch (err) {
      console.warn("[Gruper] Failed to name group", group.name, err);
    }
    applied.push({ ...group, tabIds: grouped });
  }

  const groupedIds = new Set(applied.flatMap((g) => g.tabIds));
  console.log(
    `[Gruper] Model returned ${groups.length} groups, applied ${applied.length}.`,
    `${groupedIds.size}/${allTabs.length} tabs grouped. Left out:`,
    allTabs.filter((t) => t.id != null && !groupedIds.has(t.id)).map((t) => t.title),
  );

  return applied;
}
