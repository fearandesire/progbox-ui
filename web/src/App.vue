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
        <a
          href="https://github.com/fearandesire/progbox-ui"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-auto text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label="GitHub repository"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
