<script setup lang="ts">
import type { TabGroup } from "@/utils/config";

defineProps<{ group: TabGroup }>();

const colorClass: Record<string, string> = {
  grey: "bg-group-grey",     blue: "bg-group-blue",
  red: "bg-group-red",       yellow: "bg-group-yellow",
  green: "bg-group-green",   pink: "bg-group-pink",
  purple: "bg-group-purple", cyan: "bg-group-cyan",
  orange: "bg-group-orange",
};
</script>

<template>
  <div class="flex items-center gap-2.5 p-2 bg-surface rounded-md border border-divider transition-colors hover:bg-surface-hover">
    <div class="size-2.5 rounded-full shrink-0" :class="colorClass[group.color] ?? 'bg-group-grey'" />
    <span class="flex-1 text-xs font-medium text-text truncate">{{ group.name }}</span>
    <span class="text-2xs text-muted">{{ group.tabIds.length }} tab{{ group.tabIds.length !== 1 ? "s" : "" }}</span>
  </div>
</template>
