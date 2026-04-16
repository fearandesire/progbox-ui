<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <div class="min-h-svh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <header
      class="sticky top-0 z-20 border-b border-neutral-200/80 bg-white/95 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
    >
      <nav class="mx-auto flex max-w-4xl items-center gap-6 px-4 py-4">
        <RouterLink
          to="/"
          class="text-lg font-semibold tracking-tight text-sky-700 transition-colors hover:text-sky-600 dark:text-sky-300 dark:hover:text-sky-200"
        >
          Progbox
        </RouterLink>
        <RouterLink
          to="/"
          class="text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          active-class="font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Dashboard
        </RouterLink>
        <RouterLink
          to="/new"
          class="text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          active-class="font-semibold text-neutral-900 dark:text-neutral-100"
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
