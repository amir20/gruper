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

export const DEFAULT_MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

export const AVAILABLE_MODELS = [
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  "Phi-3.5-mini-instruct-q4f16_1-MLC",
];

export const SYSTEM_PROMPT = `You are a browser tab organizer. Given a list of tabs, output ONLY a JSON object grouping them by content/topic similarity.

Rules:
- Group by topic/content, NOT by domain. Two tabs from the same site may be in different groups.
- NEVER put all tabs in one group — always split by topic.
- Group names: 2-4 words max.
- Every tab must belong to exactly one group. Do NOT skip any tabs.
- Use a different color per group. Colors: grey, blue, red, yellow, green, pink, purple, cyan, orange.
- Copy each tab id number EXACTLY as given — do not truncate or modify them.
- Output ONLY the JSON object, no explanation, no markdown, no code fences.

Example output:
{"groups":[{"name":"News","color":"red","tabIds":[123,456]},{"name":"Dev Tools","color":"blue","tabIds":[789]}]}`;

export function sanitize(str = ""): string {
  return str.replace(/["'\n\r]/g, " ").slice(0, 120);
}

export function formatTabsForPrompt(tabs: chrome.tabs.Tab[]): string {
  return tabs
    .map((t) => `id:${t.id} title:"${sanitize(t.title)}" url:"${sanitize(t.url)}"`)
    .join("\n");
}

export async function getCurrentTabs(): Promise<chrome.tabs.Tab[]> {
  // Find the last focused normal window — "currentWindow" from a service worker
  // context may resolve to a DevTools or popup window which can't have tab groups.
  const lastFocused = await chrome.windows.getLastFocused();
  let windowId = lastFocused.id!;

  // If the focused window isn't a normal window, find one that is
  if (lastFocused.type !== "normal") {
    const allWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (allWindows.length === 0) return [];
    windowId = allWindows[0].id!;
  }

  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
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

export async function applyGroups(groups: TabGroup[], allTabs: chrome.tabs.Tab[]): Promise<TabGroup[]> {
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
