<script setup lang="ts">
import type { Status } from "@/composables/useEngine";

defineProps<{ state: Status }>();

const styles: Record<Status, string> = {
  loading: "bg-warn shadow-glow-warn animate-pulse-slow",
  ready:   "bg-success shadow-glow-success",
  error:   "bg-danger shadow-glow-danger",
  working: "bg-accent shadow-glow-accent animate-pulse-fast",
};
</script>

<template>
  <div class="size-2 rounded-full shrink-0 transition-all duration-300" :class="styles[state]" />
</template>
