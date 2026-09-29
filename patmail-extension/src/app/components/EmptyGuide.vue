<script setup lang="ts">
defineProps<{ text: string; action: string; hash: string }>()

function go(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash.startsWith('/') ? hash : `/${hash}`}`
  if (location.pathname.endsWith('app.html')) {
    location.hash = next
    return
  }
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome
  const url = runtime?.runtime?.getURL?.(`app.html${next}`)
  if (url) {
    window.open(url)
    return
  }
  location.hash = next
}
</script>

<template>
  <div class="empty-guide">
    <p>{{ text }}</p>
    <button type="button" class="solid" @click="go(hash)">{{ action }}</button>
  </div>
</template>
