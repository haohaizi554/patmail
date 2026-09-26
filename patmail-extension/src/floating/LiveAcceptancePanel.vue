<script setup lang="ts">
import { computed, ref } from 'vue'
import { READONLY_ACCEPTANCE_CALLS, type LiveAcceptanceRecord } from '../automation/acceptance-runner'
import { isConfirmedOperator } from '../automation/operator'
import { MessageType, type MessageBridge } from '../shared/message'
import { sendToBackground } from '../utils/runtime'

const props = defineProps<{ bridge?: MessageBridge; userId: string }>()
const records = ref<LiveAcceptanceRecord[]>([])
const selected = ref('')
const message = ref('')
const busy = ref(false)
const ready = computed(() => isConfirmedOperator(props.userId))
const pageOrigin = location.origin

async function reload(): Promise<void> {
  if (!ready.value) {
    records.value = []
    return
  }
  const response = await sendToBackground({ type: MessageType.ListAcceptance, payload: { origin: location.origin, operatorId: props.userId } })
  records.value = response?.type === MessageType.AcceptanceResult ? response.payload.records as unknown as LiveAcceptanceRecord[] : []
}

async function run(call: string): Promise<void> {
  if (!props.bridge) {
    message.value = '当前页面不能发起只读验收。'
    return
  }
  if (!ready.value) {
    message.value = '当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。'
    return
  }
  busy.value = true
  const response = await props.bridge.request({ type: MessageType.RunReadonlyAcceptance, payload: { call, expected: {} } })
  busy.value = false
  if (response.type !== MessageType.AcceptanceResult) {
    message.value = '只读验收没有返回结果。'
    return
  }
  const row = response.payload.records[0] as unknown as LiveAcceptanceRecord | undefined
  if (!row) return
  row.operatorId = props.userId
  records.value = [row, ...records.value.filter(item => item.call !== row.call)]
  selected.value = row.call
  await sendToBackground({ type: MessageType.SaveAcceptance, payload: { record: row as unknown as Record<string, unknown> } })
  message.value = `${row.call} ${row.result}`
}

async function runAll(): Promise<void> {
  for (const call of READONLY_ACCEPTANCE_CALLS) {
    if (busy.value) return
    await run(call)
  }
}

async function copyReport(): Promise<void> {
  const text = JSON.stringify(records.value.map(item => ({
    call: item.call, result: item.result, httpStatus: item.httpStatus, reason: item.reason,
    responseShape: item.responseShape, validatedFields: item.validatedFields, finishedAt: item.finishedAt
  })))
  try {
    await navigator.clipboard.writeText(text)
    message.value = '已复制脱敏验收报告。'
  } catch {
    message.value = text
  }
}
</script>

<template>
  <section class="file-card" aria-label="接口验收">
    <p class="mail-stage">接口验收</p>
    <p class="hint">当前 Origin {{ pageOrigin }}</p>
    <p class="hint">当前 EASY 用户 {{ ready ? userId : '尚未确认' }}</p>
    <button type="button" class="text-button" :disabled="busy || !ready" @click="runAll">执行只读验收</button>
    <button type="button" class="text-button" :disabled="!selected || busy" @click="run(selected)">重新验证单项</button>
    <button type="button" class="text-button" :disabled="records.length === 0" @click="copyReport">导出脱敏验收报告</button>
    <p v-if="message" class="hint">{{ message }}</p>
    <ul>
      <li v-for="call in READONLY_ACCEPTANCE_CALLS" :key="call">
        <button type="button" class="text-button" @click="selected = call">
          {{ call }} {{ records.find(item => item.call === call)?.result ?? '尚未验证' }}
          <template v-if="records.find(item => item.call === call)"> · {{ records.find(item => item.call === call)?.finishedAt }}</template>
        </button>
      </li>
    </ul>
    <p v-if="selected && records.find(item => item.call === selected)" class="hint">
      {{ records.find(item => item.call === selected)?.responseShape }} · {{ records.find(item => item.call === selected)?.reason }}
    </p>
  </section>
</template>
