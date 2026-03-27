// src/config.ts
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

export const DEFAULT_MODEL = "Qwen2.5-7B-Instruct-q4f16_1-MLC";

export const AVAILABLE_MODELS = [
  "Qwen2.5-7B-Instruct-q4f16_1-MLC",
  "Llama-3.1-8B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
];

export { default as SYSTEM_PROMPT } from "./system-prompt.txt?raw";

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
  const lastFocused = await chrome.windows.getLastFocused();
  let windowId = lastFocused.id;

  // If the focused window isn't a normal window, find one that is
  if (lastFocused.type !== "normal" || windowId == null) {
    const allWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (allWindows.length === 0) return [];
    windowId = allWindows[0].id;
    if (windowId == null) return [];
  }

  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && !t.pinned);
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

export async function applyGroups(groups: TabGroup[], allTabs: chrome.tabs.Tab[]): Promise<TabGroup[]> {
  const validTabIds = new Set(allTabs.map((t) => t.id).filter((id): id is number => id !== undefined));
  const windowId = allTabs[0]?.windowId;
  const applied: TabGroup[] = [];

  for (const group of groups) {
    const ids = (group.tabIds || []).filter((id) => validTabIds.has(id));
    if (ids.length === 0) continue;

    const color: TabGroupColor = VALID_COLORS.has(group.color) ? group.color : "grey";

    const groupId = await chrome.tabs.group({
      tabIds: ids as [number, ...number[]],
      createProperties: windowId ? { windowId } : undefined,
    });
    await chrome.tabGroups.update(groupId, {
      title: group.name,
      color,
      collapsed: false,
    });

    applied.push({ ...group, tabIds: ids });
  }

  return applied;
}
