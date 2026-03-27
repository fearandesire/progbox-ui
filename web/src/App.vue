<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <div class="min-h-svh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <header
      class="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      <nav class="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
        <RouterLink
          to="/"
          class="font-semibold text-violet-700 dark:text-violet-400"
        >
          Progbox
        </RouterLink>
        <RouterLink
          to="/"
          class="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          active-class="font-medium text-neutral-900 dark:text-neutral-100"
        >
          Dashboard
        </RouterLink>
        <RouterLink
          to="/new"
          class="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          New sim
        </RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
