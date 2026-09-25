<script setup lang="ts">
import { computed, ref } from 'vue'
import { runDryRun } from '../automation/dry-run'
import { exportDiagnostic } from '../automation/logger'
import { recoverTask } from '../automation/recovery'
import { validateTask } from '../automation/task-validator'
import type { AutomationTask } from '../automation/types'
import { EASY_MAIL_WRITES_ENABLED } from '../mail/easy/gate'
import type { CustomerQueryProfile } from '../customer/types'
import type { MailRuleBundle, SelectedPatentFile } from '../mail/types'
import { MAIL_FLOW_TYPE } from '../workflow/contracts'
import { WORKFLOW_WRITES_ENABLED } from '../workflow/gate'
import { MessageType, type ExistingMailDiagnostic, type MessageBridge } from '../shared/message'

const props = defineProps<{
  bridge?: MessageBridge
  userId: string
  files: SelectedPatentFile[]
  rules: MailRuleBundle
  profiles: CustomerQueryProfile[]
  queryTemplateVersion: number
}>()

const task = ref<AutomationTask | null>(null)
const checked = ref<AutomationTask | null>(null)
const showBlockers = ref(false)
const selectedItem = ref('')
const message = ref('')
const diagnosticId = ref('')
const diagnostic = ref<ExistingMailDiagnostic | null>(null)
const busy = ref(false)

const items = computed(() => checked.value?.items ?? [])
const active = computed(() => items.value.find(item => item.itemId === selectedItem.value) ?? items.value[0] ?? null)
const recovery = computed(() => checked.value ? recoverTask(checked.value) : null)

function plan(): void {
  const result = runDryRun({
    origin: location.origin,
    operatorId: props.userId || 'session',
    files: props.files,
    rules: props.rules,
    profiles: props.profiles,
    queryTemplateVersion: props.queryTemplateVersion
  }, null)
  task.value = result.task
  checked.value = validateTask(result.task, {
    origin: location.origin,
    operatorId: props.userId || 'session',
    files: props.files,
    rules: props.rules,
    profiles: props.profiles,
    queryTemplateVersion: props.queryTemplateVersion
  })
  selectedItem.value = checked.value.items[0]?.itemId ?? ''
  message.value = result.writeCalls.length === 0 ? '计划已生成。没有发出写请求。' : '计划包含写请求，已停止。'
}

function recheck(): void {
  if (!task.value) return
  checked.value = validateTask(task.value, {
    origin: location.origin,
    operatorId: props.userId || 'session',
    files: props.files,
    rules: props.rules,
    profiles: props.profiles,
    queryTemplateVersion: props.queryTemplateVersion
  })
  message.value = checked.value.status === 'STALE' ? '当前文件或规则已经变化，旧计划不能继续。' : '已按当前配置重新核对。'
}

async function copyDiagnostic(): Promise<void> {
  if (!checked.value) return
  const text = exportDiagnostic([{
    taskId: checked.value.taskId, executionId: '', itemId: active.value?.itemId ?? '', stage: 'DRAFT_VALIDATE',
    event: 'diagnostic', status: checked.value.status, durationMs: 0,
    errorCode: checked.value.issues.map(item => item.code).join(','), timestamp: checked.value.updatedAt
  }])
  try {
    await navigator.clipboard.writeText(text)
    message.value = '已复制脱敏诊断。'
  } catch {
    message.value = text
  }
}

async function diagnose(): Promise<void> {
  if (!props.bridge || !diagnosticId.value) return
  busy.value = true
  const response = await props.bridge.request({
    type: MessageType.DiagnoseExistingMail,
    payload: { mailId: diagnosticId.value.trim(), flowType: MAIL_FLOW_TYPE }
  })
  busy.value = false
  if (response.type !== MessageType.ExistingMailDiagnostic) {
    message.value = '只读核验没有返回结果。'
    return
  }
  diagnostic.value = response.payload
  message.value = response.payload.writesAttempted ? '核验异常。' : '只读核验完成，没有保存或提交。'
}
</script>

<template>
  <section class="file-card" aria-label="发文任务">
    <p class="mail-stage" role="status">任务计划</p>
    <p class="hint">真实邮件创建、保存、文件关联和流程提交保持关闭。</p>
    <p v-if="EASY_MAIL_WRITES_ENABLED || WORKFLOW_WRITES_ENABLED" class="hint">写开关状态异常。</p>
    <button type="button" class="text-button" :disabled="files.length === 0" @click="plan">生成计划</button>
    <button type="button" class="text-button" :disabled="!checked" @click="showBlockers = !showBlockers">查看阻塞项</button>
    <button type="button" class="text-button" :disabled="!checked" @click="recheck">重新核对</button>
    <button type="button" class="text-button" :disabled="!checked" @click="copyDiagnostic">复制脱敏诊断</button>
    <p v-if="message" class="hint">{{ message }}</p>
    <article v-if="checked" class="file-card">
      <strong>{{ checked.name }}</strong>
      <p class="hint">客户 {{ checked.customerName || '未绑定' }} · 文件 {{ checked.selectedFiles.length }} · 预计邮件 {{ checked.items.length }}</p>
      <p class="hint">状态 {{ checked.status }} · 创建 {{ checked.createdAt }} · 最近核对 {{ checked.updatedAt }}</p>
      <label v-if="items.length">分组
        <select v-model="selectedItem">
          <option v-for="item in items" :key="item.itemId" :value="item.itemId">{{ item.mailTypeName || '未映射' }} · {{ item.status }}</option>
        </select>
      </label>
      <div v-if="active">
        <p class="hint">方式 {{ active.sendMode }} · 描述 {{ active.fileDescriptionIdentity || '缺失' }} · 发文类型 {{ active.mailTypeName || '未映射' }}</p>
        <p class="hint">文件 {{ active.fileNames.join('、') || '空' }}</p>
        <p class="hint">收件人 {{ active.mailDraftPreview?.to.join('、') || '空' }} · 抄送 {{ active.mailDraftPreview?.cc.join('、') || '空' }}</p>
        <p>{{ active.mailDraftPreview?.subject || '无主题' }}</p>
        <p v-if="active.mailDraftPreview?.signature" class="hint">签名：{{ active.mailDraftPreview.signature }}</p>
        <p class="hint">当前步骤 {{ active.status }} · 邮件 {{ active.easyMailId || '尚未创建' }}</p>
      </div>
      <ul v-if="showBlockers">
        <li v-for="issue in checked.issues" :key="issue.code + issue.itemId" class="hint">{{ issue.message }}</li>
        <li v-if="checked.issues.length === 0" class="hint">没有阻塞项。</li>
      </ul>
      <p v-if="recovery" class="hint">恢复：{{ recovery.reason }}</p>
      <p class="hint">已创建邮件 {{ active?.easyMailId || '无' }} · 最后核验 {{ checked.updatedAt }}</p>
    </article>
    <label>已有 EASY 邮件 ID<input v-model="diagnosticId" type="text" /></label>
    <button type="button" class="text-button" :disabled="busy || !diagnosticId" @click="diagnose">只读核验</button>
    <p v-if="diagnostic" class="hint">邮件 {{ diagnostic.mailId }} · 文件 {{ diagnostic.fileNames.join('、') || '无' }} · 流程 {{ diagnostic.workflow.record.status }}</p>
    <p v-for="item in diagnostic?.blockers ?? []" :key="item" class="hint">{{ item }}</p>
  </section>
</template>
