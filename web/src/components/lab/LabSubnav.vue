<script setup lang="ts">
/* Lab sub-navigation shared by every Lab page. `current` marks the active tab; a run report marks none. */
defineProps<{ current?: "new" | "scripts" | "history" }>();
</script>

<template>
  <nav
    class="lab-subnav"
    aria-label="Lab"
  >
    <RouterLink
      to="/lab"
      class="chip"
      :class="{ active: current === 'new' }"
      :aria-current="current === 'new' ? 'page' : undefined"
    >
      New test
    </RouterLink>
    <RouterLink
      to="/lab/scripts"
      class="chip"
      :class="{ active: current === 'scripts' }"
      :aria-current="current === 'scripts' ? 'page' : undefined"
    >
      Scripts
    </RouterLink>
    <RouterLink
      to="/lab/history"
      class="chip"
      :class="{ active: current === 'history' }"
      :aria-current="current === 'history' ? 'page' : undefined"
    >
      History
    </RouterLink>
  </nav>
</template>
