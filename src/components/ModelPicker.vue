<script setup lang="ts">
import { AVAILABLE_MODELS } from "../config";

const { current } = defineProps<{ current: string }>();
const emit = defineEmits<{
  select: [model: string];
  close: [];
}>();
</script>

<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="emit('close')">
    <div class="bg-surface border border-divider rounded-lg p-4 w-75 shadow-xl">
      <div class="text-sm font-semibold text-text mb-1">Choose Model</div>
      <div class="text-[10px] text-muted mb-3">Changing model triggers a new download.</div>

      <div class="flex flex-col gap-1.5">
        <button
          v-for="model in AVAILABLE_MODELS"
          :key="model"
          class="w-full text-left px-3 py-2 rounded-md text-xs border transition-colors"
          :class="model === current
            ? 'bg-accent/15 border-accent/30 text-accent'
            : 'bg-bg border-divider text-text-secondary hover:bg-surface-hover hover:text-text'"
          @click="emit('select', model)"
        >
          {{ model }}
        </button>
      </div>

      <button
        class="mt-3 w-full py-1.5 text-xs text-muted hover:text-text-secondary transition-colors cursor-pointer bg-transparent border-none"
        @click="emit('close')"
      >
        Cancel
      </button>
    </div>
  </div>
</template>
