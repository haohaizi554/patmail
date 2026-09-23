<script setup>
import { computed } from 'vue'
const props = defineProps({
  parts: { type: Array, required: true },
  size: { type: Number, default: 148 }
})
const bg = computed(() => {
  let at = 0
  return `conic-gradient(${props.parts.map((p) => {
    const start = at
    at += p.value
    return `${p.color} ${start}% ${at}%`
  }).join(',')})`
})
</script>

<template>
  <div class="donut" :style="{ width: size + 'px', height: size + 'px', background: bg }">
    <div class="donut-hole"><slot /></div>
  </div>
</template>
