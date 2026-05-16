<script setup lang="ts">
/* Small ⓘ glyph with a hover/focus bubble. Used to attach a
   plain-English explanation to any math-y label. */
withDefaults(defineProps<{ label?: string }>(), { label: "More info" });
</script>

<template>
  <span
    class="info-tip"
    tabindex="0"
    :aria-label="label"
  >
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        stroke-width="1.25"
      />
      <path
        d="M8 7.25v4.25"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      />
      <circle
        cx="8"
        cy="5"
        r="0.75"
        fill="currentColor"
      />
    </svg>
    <span
      class="info-tip__bubble"
      role="tooltip"
    ><slot /></span>
  </span>
</template>
