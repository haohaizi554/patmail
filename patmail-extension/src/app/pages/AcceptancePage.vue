<script setup lang="ts">
import { computed, ref } from 'vue'
import { acceptanceBlockReason } from '../../automation/acceptance-context'
import { READONLY_ACCEPTANCE_CALLS } from '../../automation/acceptance-runner'
import { MessageType } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const selected = ref<string>(READONLY_ACCEPTANCE_CALLS[0])
const caseTypeId = ref('')
const mailId = ref('')
const flowType = ref('')
const expectedText = ref('')
const resultText = ref('')

function expectedFields(): Record<string, string> {
  const output: Record<string, string> = {}
  for (const line of expectedText.value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    output[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return output
}

async function run(): Promise<void> {
  const context = { caseTypeId: caseTypeId.value.trim(), mailId: mailId.value.trim(), flowType: flowType.value.trim(), expectedFields: expectedFields() }
  const blocked = acceptanceBlockReason(selected.value, context)
  if (blocked) {
    resultText.value = `${selected.value} BLOCKED · ${blocked}`
    return
  }
  const payload = await call({
    action: 'runAcceptance',
    call: selected.value,
    ...(context.caseTypeId ? { caseTypeId: context.caseTypeId } : {}),
    ...(context.mailId ? { mailId: context.mailId } : {}),
    ...(context.flowType ? { flowType: context.flowType } : {}),
    ...(Object.keys(context.expectedFields).length ? { expectedFields: context.expectedFields } : {})
  })
  const forwarded = payload?.forwarded
  const row = forwarded && forwarded.type === MessageType.AcceptanceResult ? forwarded.payload.records[0] : null
  if (!row) {
    resultText.value = payload?.message || '没有验收结果。'
    return
  }
  const compared = row.matchedWithUi === true ? '已对照原网页' : '未与原网页对照'
  const source = row.evidenceSource === 'MANUAL_EXPECTATION' ? ' · 手工期望' : row.evidenceSource === 'API_RESPONSE' ? ' · 接口响应' : row.evidenceSource === 'MOCK' ? ' · Mock' : ''
  const layer = row.acceptanceLayer ? ` · ${row.acceptanceLayer}` : ''
  const level = typeof row.evidenceLevel === 'string' ? ` · ${row.evidenceLevel}` : ''
  resultText.value = `${String(row.call)} ${String(row.result)} · ${String(row.reason ?? '')} · ${compared}${source}${layer}${level}`
}
</script>

<template>
  <section class="pm-card">
    <h2>接口验收</h2>
    <p class="hint">只读请求由已绑定的 EASY 标签页发出。缺少业务参数或契约未确认时显示 BLOCKED，不会发出请求。HTTP 200 只说明传输层有响应。手工填写的对照字段只能说明接口响应和手工期望一致，不能记成原网页对照。</p>
    <p v-if="!ready" class="empty">尚未确认 EASY 用户，不能执行验收。</p>
    <div v-else class="pm-form">
      <label>接口
        <select v-model="selected">
          <option v-for="item in READONLY_ACCEPTANCE_CALLS" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label>案件类型 ID <input v-model="caseTypeId" type="text" /></label>
      <label>邮件 ID <input v-model="mailId" type="text" /></label>
      <label>流程类型 <input v-model="flowType" type="text" /></label>
      <label>对照字段 <textarea v-model="expectedText" rows="3" placeholder="userId=..."></textarea></label>
      <button type="button" class="solid" @click="run">执行只读验收</button>
    </div>
    <p v-if="resultText" class="hint">{{ resultText }}</p>
  </section>
</template>
