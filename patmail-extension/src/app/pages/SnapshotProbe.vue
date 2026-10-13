<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadSmeCustomerSnapshot } from '../../customer/sme-customers'

const lines = ref<string[]>(['开始'])
function log(text: string): void {
  lines.value.push(text)
}

onMounted(async () => {
  log('开始读取快照')
  const t0 = performance.now()
  try {
    const snapshot = await loadSmeCustomerSnapshot(true)
    log(`耗时 ${Math.round(performance.now() - t0)}ms`)
    if (snapshot) {
      log(`读到 ${snapshot.customers.length} 家，快照时间 ${snapshot.takenAt}`)
    } else {
      log('快照没有读到：文件缺失或解析失败。')
    }
  } catch (error) {
    log(`读快照抛错：${error instanceof Error ? error.message : String(error)}`)
  }
})
</script>

<template>
  <div style="padding: 24px; font-family: monospace; font-size: 14px; white-space: pre-line;">
    <p v-for="line in lines" :key="line">{{ line }}</p>
  </div>
</template>