<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LiveAcceptanceRecord } from '../automation/acceptance-runner'
import { buildTask } from '../automation/task-builder'
import { CLOSED_TEST_SCOPE, evaluateTestWrite, executionMode } from '../automation/test-write'
import { isConfirmedOperator } from '../automation/operator'
import type { CustomerQueryProfile } from '../customer/types'
import type { MailRuleBundle, SelectedPatentFile } from '../mail/types'
import type { StageId } from '../automation/types'
import type { MessageBridge } from '../shared/message'

const props = defineProps<{
  bridge?: MessageBridge
  userId: string
  files: SelectedPatentFile[]
  rules: MailRuleBundle
  profiles: CustomerQueryProfile[]
  queryTemplateVersion: number
  businessOrigin: string
}>()

const stage = ref<StageId>('MAIL_CREATE')
const confirmed = ref(false)
const message = ref('')
const preview = ref('')
const steps: Array<{ id: StageId; label: string }> = [
  { id: 'MAIL_CREATE', label: 'MailCustomer' },
  { id: 'MAIL_SAVE', label: 'SaveMailInfo' },
  { id: 'FILE_BIND', label: 'SaveMailRalteCaseFile' },
  { id: 'WORKFLOW_SUBMIT', label: 'FlowSubmit' }
]
const ready = computed(() => isConfirmedOperator(props.userId))
const mode = executionMode('TEST_WRITE')

function taskNow() {
  return buildTask({
    origin: props.businessOrigin,
    operatorId: props.userId,
    files: props.files,
    rules: props.rules,
    profiles: props.profiles,
    queryTemplateVersion: props.queryTemplateVersion
  })
}

function explain(): string[] {
  if (!mode || !ready.value) return ['当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。']
  return evaluateTestWrite({
    mode,
    task: taskNow(),
    scope: { ...CLOSED_TEST_SCOPE, allowedOrigin: props.businessOrigin, operatorId: props.userId },
    stage: stage.value,
    acceptance: [] as LiveAcceptanceRecord[],
    evidence: [],
    userConfirmed: confirmed.value
  })
}

async function precheck(): Promise<void> {
  const blockers = explain()
  preview.value = JSON.stringify({ stage: stage.value, mode, fileIds: props.files.map(file => file.fileId) })
  message.value = blockers[0] ?? '只读预检没有发现门禁问题。仍不会自动进入下一步。'
}

function confirmStep(): void {
  const blockers = explain()
  message.value = blockers[0] ?? '当前步骤没有执行写请求。'
}

function readbackOnly(): void {
  message.value = '请执行只读核对。PatMail 不会自动重试未知的写请求。'
}
</script>

<template>
  <section class="file-card" aria-label="受控测试执行">
    <p class="mail-stage">测试写</p>
    <p class="hint">生产写操作保持关闭。这里没有一键执行，也不能把未知结果重试。</p>
    <p class="hint">测试范围 {{ ready ? '等待本地白名单' : '用户未确认' }} · 模式 TEST_WRITE</p>
    <label>当前步骤
      <select v-model="stage">
        <option v-for="item in steps" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
    </label>
    <label><input v-model="confirmed" type="checkbox" /> 我确认只执行这一项测试</label>
    <button type="button" class="text-button" @click="precheck">只读预检</button>
    <button type="button" class="text-button" @click="confirmStep">确认执行当前测试步骤</button>
    <button type="button" class="text-button" @click="readbackOnly">只读回读</button>
    <p v-if="preview" class="hint">{{ preview }}</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <p class="hint">结束流程、审核和邮件发送不会在这一阶段执行。</p>
  </section>
</template>
