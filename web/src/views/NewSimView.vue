<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8">
    <RouterLink
      to="/"
      class="mb-6 inline-block text-sm text-violet-600 hover:underline"
    >
      ← Back
    </RouterLink>
    <h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
      New simulation
    </h1>
    <p class="mt-4 text-neutral-600 dark:text-neutral-400">
      Upload, configure, and launch (Block 5).
    </p>
  </div>
</template>
