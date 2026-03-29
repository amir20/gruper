<script setup lang="ts">
defineProps<{ pct: number; label: string }>();
</script>

<template>
  <div class="px-4 py-2.5 border-b border-divider">
    <div class="w-full h-1 bg-divider rounded-sm overflow-hidden">
      <div class="h-full bg-accent rounded-sm transition-[width] duration-300 ease-out" :style="{ width: pct + '%' }" />
    </div>
    <div class="mt-1.5 text-muted text-2xs">{{ label }}</div>
  </div>
</template>
