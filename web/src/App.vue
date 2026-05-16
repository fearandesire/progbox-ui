<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";
import DeIcon from "./components/DeIcon.vue";
import { useTheme } from "./composables/useTheme";

const route = useRoute();
const { theme, toggle } = useTheme();
</script>

<template>
  <div class="de-canvas">
    <header class="topbar">
      <div class="topbar__inner">
        <RouterLink
          to="/"
          class="brand"
          aria-label="Progbox home"
        >
          <span class="brand__mark">P</span>
          <span>Progbox</span>
        </RouterLink>
        <RouterLink
          to="/"
          class="nav-link"
          :class="{ active: route.name === 'dashboard' }"
        >
          Dashboard
        </RouterLink>
        <RouterLink
          to="/new"
          class="nav-link"
          :class="{ active: route.name === 'new-sim' }"
        >
          New sim
        </RouterLink>
        <div class="topbar__right">
          <button
            class="theme-toggle"
            type="button"
            aria-label="Toggle theme"
            @click="toggle"
          >
            <DeIcon
              :name="theme === 'light' ? 'sun' : 'moon'"
              :size="12"
            />
            <span>{{ theme.toUpperCase() }}</span>
          </button>
          <a
            href="https://github.com/fearandesire/progbox-ui"
            target="_blank"
            rel="noopener noreferrer"
            class="gh"
            aria-label="GitHub repository"
          >
            <DeIcon
              name="github"
              :size="18"
            />
          </a>
        </div>
      </div>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
