<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  AVAILABLE_MODELS,
  POPULAR_OPENROUTER_MODELS,
  getProviderConfig,
  type Provider,
  type ModelOption,
} from "@/utils/config";

const emit = defineEmits<{
  apply: [config: { provider: Provider; model?: string; openrouterApiKey?: string; openrouterModel?: string }];
  close: [];
}>();

const provider = ref<Provider>("local");
const localModel = ref("");
const apiKey = ref("");
const openrouterModel = ref("");
const customModel = ref("");
const showApiKey = ref(false);

onMounted(async () => {
  const config = await getProviderConfig();
  provider.value = config.provider;
  localModel.value = config.model;
  apiKey.value = config.openrouterApiKey;
  openrouterModel.value = config.openrouterModel;
  // If the saved model isn't in the popular list, put it in customModel
  if (config.openrouterModel && !POPULAR_OPENROUTER_MODELS.includes(config.openrouterModel)) {
    customModel.value = config.openrouterModel;
  }
});

function selectOpenRouterModel(model: string) {
  openrouterModel.value = model;
  customModel.value = "";
}

function onCustomModelInput() {
  if (customModel.value.trim()) {
    openrouterModel.value = customModel.value.trim();
  }
}

function save() {
  if (provider.value === "openrouter") {
    emit("apply", {
      provider: "openrouter",
      openrouterApiKey: apiKey.value,
      openrouterModel: openrouterModel.value,
    });
  } else {
    emit("apply", {
      provider: "local",
      model: localModel.value,
    });
  }
}
</script>

<template>
  <div class="bg-bg p-4 w-popup text-text font-sans text-sm antialiased">
      <div class="text-sm font-semibold text-text mb-3">Settings</div>

      <!-- Provider toggle -->
      <div class="flex rounded-md border border-divider overflow-hidden mb-4">
        <button
          class="flex-1 py-1.5 text-xs font-medium transition-colors border-none cursor-pointer"
          :class="provider === 'local' ? 'bg-accent/15 text-accent' : 'bg-bg text-muted hover:text-text-secondary'"
          @click="provider = 'local'"
        >
          Local (WebLLM)
        </button>
        <button
          class="flex-1 py-1.5 text-xs font-medium transition-colors border-none cursor-pointer"
          :class="provider === 'openrouter' ? 'bg-accent/15 text-accent' : 'bg-bg text-muted hover:text-text-secondary'"
          @click="provider = 'openrouter'"
        >
          OpenRouter
        </button>
      </div>

      <!-- Local model list -->
      <template v-if="provider === 'local'">
        <div class="text-[10px] text-muted mb-2">Runs entirely in your browser via WebGPU.</div>
        <div class="flex flex-col gap-1.5">
          <button
            v-for="model in AVAILABLE_MODELS"
            :key="model.id"
            class="w-full text-left px-3 py-2 rounded-md text-xs border transition-colors cursor-pointer"
            :class="model.id === localModel
              ? 'bg-accent/15 border-accent/30 text-accent'
              : 'bg-bg border-divider text-text-secondary hover:bg-surface-hover hover:text-text'"
            @click="localModel = model.id"
          >
            {{ model.id }}
            <span v-if="model.recommended" class="ml-1 text-[10px] text-accent/70">(recommended)</span>
          </button>
        </div>
      </template>

      <!-- OpenRouter config -->
      <template v-else>
        <div class="text-[10px] text-muted mb-3">Use any model via OpenRouter's API.</div>

        <!-- API Key -->
        <label class="block mb-3">
          <span class="text-[10px] text-muted font-medium uppercase tracking-wider">API Key</span>
          <div class="relative mt-1">
            <input
              v-model="apiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="sk-or-..."
              class="w-full px-3 py-2 bg-bg border border-divider rounded-md text-xs text-text placeholder-muted/50 focus:outline-none focus:border-accent/50"
            />
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer"
              @click="showApiKey = !showApiKey"
            >
              {{ showApiKey ? 'hide' : 'show' }}
            </button>
          </div>
        </label>

        <!-- Model selection -->
        <div class="mb-2">
          <span class="text-[10px] text-muted font-medium uppercase tracking-wider">Model</span>
        </div>
        <div class="flex flex-col gap-1.5 mb-2">
          <button
            v-for="model in POPULAR_OPENROUTER_MODELS"
            :key="model"
            class="w-full text-left px-3 py-2 rounded-md text-xs border transition-colors cursor-pointer"
            :class="model === openrouterModel && !customModel
              ? 'bg-accent/15 border-accent/30 text-accent'
              : 'bg-bg border-divider text-text-secondary hover:bg-surface-hover hover:text-text'"
            @click="selectOpenRouterModel(model)"
          >
            {{ model }}
          </button>
        </div>

        <!-- Custom model input -->
        <input
          v-model="customModel"
          placeholder="or type any model id..."
          class="w-full px-3 py-2 bg-bg border border-divider rounded-md text-xs text-text placeholder-muted/50 focus:outline-none focus:border-accent/50"
          @input="onCustomModelInput"
        />
      </template>

      <!-- Actions -->
      <div class="flex gap-2 mt-4">
        <button
          class="flex-1 py-2 text-xs font-medium rounded-md bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors"
          @click="save"
        >
          Save
        </button>
        <button
          class="flex-1 py-2 text-xs text-muted hover:text-text-secondary transition-colors cursor-pointer bg-transparent border border-divider rounded-md"
          @click="emit('close')"
        >
          Cancel
        </button>
      </div>
  </div>
</template>
