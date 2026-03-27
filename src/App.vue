<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getCurrentTabs, applyGroups, toMessage, type TabGroup } from "./config";
import { useEngine } from "./composables/useEngine";
import StatusDot from "./components/StatusDot.vue";
import ProgressBar from "./components/ProgressBar.vue";
import GroupItem from "./components/GroupItem.vue";
import ModelPicker from "./components/ModelPicker.vue";

const engine = useEngine();
const { status, statusText, error, currentModel, modelBadge, progress } = engine;

const tabCount = ref<number | null>(null);
const working = ref(false);
const groups = ref<TabGroup[]>([]);
const showModelPicker = ref(false);

async function doGroupTabs() {
  engine.clearError();
  groups.value = [];
  working.value = true;
  engine.setStatus("working", "Analyzing tabs...");

  try {
    const tabs = await getCurrentTabs();
    statusText.value = `Grouping ${tabs.length} tabs...`;
    const result = await engine.groupTabs(tabs);
    const applied = await applyGroups(result, tabs);
    groups.value = applied;
    engine.setStatus("ready", `Done \u2014 ${applied.length} groups created`);
  } catch (err) {
    console.error("[TabGrouperAI]", err);
    engine.setError(toMessage(err));
  } finally {
    working.value = false;
  }
}

async function handleClearGroups() {
  try {
    await engine.clearGroups();
    groups.value = [];
    engine.setStatus("ready", "Groups cleared");
  } catch (err) {
    engine.setError(toMessage(err));
  }
}

async function onModelSelect(model: string) {
  showModelPicker.value = false;
  await engine.switchModel(model);
}

onMounted(async () => {
  tabCount.value = (await getCurrentTabs()).length;

  try {
    await engine.init();
  } catch (err) {
    if (toMessage(err).includes("unload")) {
      try { await engine.init(); } catch (e) {
        engine.setError(toMessage(e));
      }
    } else {
      engine.setError(toMessage(err));
    }
  }
});
</script>

<template>
  <div class="w-popup bg-bg text-text font-sans text-sm leading-normal antialiased">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-divider">
      <div class="flex items-center gap-2.5">
        <div class="size-6 rounded-md bg-accent flex items-center justify-center text-sm text-white">&#x2B21;</div>
        <span class="text-sm font-semibold tracking-tight">Tab Grouper AI</span>
      </div>
      <span class="text-2xs text-text-secondary bg-surface border border-divider px-2 py-0.5 rounded font-medium">
        {{ modelBadge }}
      </span>
    </header>

    <!-- Status -->
    <div class="flex items-center gap-2 px-4 py-2.5 border-b border-divider min-h-10">
      <StatusDot :state="status" />
      <span class="text-text-secondary text-xs flex-1 truncate">{{ statusText }}</span>
    </div>

    <!-- Progress -->
    <ProgressBar v-if="progress.visible" :pct="progress.pct" :label="progress.label" />

    <!-- Tab count -->
    <div v-if="tabCount != null" class="px-4 py-2.5 text-text-secondary text-xs border-b border-divider">
      <span class="text-text font-semibold">{{ tabCount }}</span> tabs in this window
    </div>

    <!-- Action -->
    <div class="px-4 py-3.5">
      <button
        :disabled="status !== 'ready' || working"
        class="btn-primary"
        @click="doGroupTabs"
      >
        {{ working ? "Working..." : "Group Tabs" }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="mx-4 mb-3 p-2.5 bg-danger/8 border border-danger/18 rounded-md text-danger text-2xs whitespace-pre-wrap max-h-36 overflow-y-auto">
      {{ error }}
    </div>

    <!-- Results -->
    <div v-if="groups.length" class="border-t border-divider">
      <div class="px-4 pt-2.5 pb-1.5 text-muted text-2xs font-semibold tracking-wider uppercase">Groups Applied</div>
      <div class="px-4 pb-3.5 flex flex-col gap-1">
        <GroupItem v-for="g in groups" :key="g.name" :group="g" />
      </div>
    </div>

    <!-- Footer -->
    <footer class="px-4 py-2 pb-3 border-t border-divider flex items-center justify-between">
      <button class="footer-link" @click="handleClearGroups">Clear groups</button>
      <button class="footer-link" @click="showModelPicker = true">Model</button>
    </footer>

    <!-- Model picker -->
    <Teleport to="body">
      <ModelPicker v-if="showModelPicker" :current="currentModel" @select="onModelSelect" @close="showModelPicker = false" />
    </Teleport>
  </div>
</template>

<style scoped>
@reference "./style.css";

.btn-primary {
  @apply w-full py-2.5 px-4 bg-accent text-white border-none rounded-lg font-sans text-sm font-semibold cursor-pointer;
  @apply transition-all duration-150;
  @apply hover:enabled:bg-accent-hover hover:enabled:shadow-glow-accent-lg;
  @apply active:enabled:scale-98;
  @apply disabled:opacity-35 disabled:cursor-not-allowed;
}

.footer-link {
  @apply text-[11px] text-muted cursor-pointer transition-colors hover:text-text-secondary bg-transparent border-none p-0;
}
</style>
