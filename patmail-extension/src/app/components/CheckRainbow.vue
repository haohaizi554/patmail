<script setup lang="ts">
import { computed } from 'vue'
import { taskCheckProgress } from '../check-progress'

const props = defineProps<{ pageOn: boolean }>()
const shown = computed(() => props.pageOn && taskCheckProgress.visible)
const caption = computed(() => {
  const progress = taskCheckProgress
  const percent = Number.isInteger(progress.percent) ? String(progress.percent) : progress.percent.toFixed(1)
  const head = `已核对 ${percent}%（${progress.done}/${progress.total}）`
  if (progress.status === 'done') return `${head} 核对结束`
  if (progress.status === 'fail') return `${head} 核对停了`
  if (progress.eta) return `${head} 预计 ${progress.eta} 结束`
  return `${head} 正在估算结束时间`
})
</script>

<template>
  <div v-if="shown" class="check-rainbow" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="taskCheckProgress.percent" :aria-valuetext="caption">
    <div class="check-rainbow-track"><span :style="{ width: taskCheckProgress.percent + '%' }"></span></div>
    <p>{{ caption }}</p>
  </div>
</template>
