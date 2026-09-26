<script setup lang="ts">
import { computed, ref } from 'vue'
import { READONLY_ACCEPTANCE_CALLS } from '../../automation/acceptance-runner'
import { MessageType } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const selected = ref<string>(READONLY_ACCEPTANCE_CALLS[0])
const resultText = ref('')

async function run(): Promise<void> {
  const payload = await call({ action: 'runAcceptance', call: selected.value })
  const forwarded = payload?.forwarded
  const row = forwarded && forwarded.type === MessageType.AcceptanceResult ? forwarded.payload.records[0] : null
  resultText.value = row ? `${String(row.call)} ${String(row.result)} · ${String(row.reason ?? '')}` : (payload?.message || '没有验收结果。')
}
</script>

<template>
  <section class="pm-card">
    <h2>接口验收</h2>
    <p class="hint">只读请求由已绑定的 EASY 标签页发出。通过与否由后台根据实际响应计算，页面不能自行声明 PASS。</p>
    <p v-if="!ready" class="empty">尚未确认 EASY 用户，不能执行验收。</p>
    <div v-else class="pm-row">
      <select v-model="selected">
        <option v-for="item in READONLY_ACCEPTANCE_CALLS" :key="item" :value="item">{{ item }}</option>
      </select>
      <button type="button" class="solid" @click="run">执行只读验收</button>
    </div>
    <p v-if="resultText" class="hint">{{ resultText }}</p>
  </section>
</template>
