<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { productionWriteAllowed } from '../automation/contract-capture'
import { runDryRun } from '../automation/dry-run'
import { LIVE_EASY_ACCEPTANCE } from '../automation/easy-acceptance'
import { exportDiagnostic } from '../automation/logger'
import { isConfirmedOperator } from '../automation/operator'
import { recoverTask } from '../automation/recovery'
import { buildStagePlans } from '../automation/stage-plan'
import { validateTask } from '../automation/task-validator'
import type { AutomationTask } from '../automation/types'
import { sendToBackground } from '../utils/runtime'
import { EASY_MAIL_WRITES_ENABLED } from '../mail/easy/gate'
import type { CustomerQueryProfile } from '../customer/types'
import type { MailRuleBundle, SelectedPatentFile } from '../mail/types'
import { MAIL_FLOW_TYPE } from '../workflow/contracts'
import { WORKFLOW_WRITES_ENABLED } from '../workflow/gate'
import { useWorkspace } from '../app/composables/useWorkspace'
import { MessageType, type ExistingMailDiagnostic, type MessageBridge, type TaskSummary } from '../shared/message'

const props = defineProps<{
  bridge?: MessageBridge
  userId: string
  files: SelectedPatentFile[]
  rules: MailRuleBundle
  profiles: CustomerQueryProfile[]
  queryTemplateVersion: number
  businessOrigin: string
}>()

const history = ref<TaskSummary[]>([])
const checked = ref<AutomationTask | null>(null)
const persisted = ref(false)
const showBlockers = ref(false)
const selectedItem = ref('')
const message = ref('')
const diagnosticId = ref('')
const diagnostic = ref<ExistingMailDiagnostic | null>(null)
const busy = ref(false)
const acceptance = LIVE_EASY_ACCEPTANCE

const items = computed(() => checked.value?.items ?? [])
const active = computed(() => items.value.find(item => item.itemId === selectedItem.value) ?? items.value[0] ?? null)
const recovery = computed(() => checked.value ? recoverTask(checked.value) : null)
const blockedPlans = computed(() => checked.value ? buildStagePlans(checked.value).filter(item => item.itemId === (active.value?.itemId ?? '') && !item.canExecute).slice(0, 8) : [])
const customerLabel = computed(() => checked.value?.customers.map(item => item.name).join('、') || checked.value?.customerName || '未绑定')

const identityReady = computed(() => isConfirmedOperator(props.userId))

function currentInput() {
  return {
    origin: props.businessOrigin,
    operatorId: props.userId,
    files: props.files,
    rules: props.rules,
    profiles: props.profiles,
    queryTemplateVersion: props.queryTemplateVersion
  }
}

async function reload(): Promise<void> {
  if (!identityReady.value) {
    history.value = []
    return
  }
  const response = await sendToBackground({ type: MessageType.ListTasks, payload: { origin: props.businessOrigin, operatorId: props.userId } })
  history.value = response?.type === MessageType.TaskResult ? response.payload.tasks : []
}

onMounted(() => { void reload() })
watch(() => props.userId, () => {
  checked.value = null
  persisted.value = false
  history.value = []
  void reload()
})

async function plan(): Promise<void> {
  const input = currentInput()
  const result = runDryRun(input, null)
  if (result.writeCalls.length > 0 || result.plans.some(item => item.sideEffect === 'write' && item.canExecute) || productionWriteAllowed()) {
    message.value = '计划包含写请求，已停止。'
    return
  }
  const task = validateTask(result.task, input)
  checked.value = task
  selectedItem.value = result.task.items[0]?.itemId ?? ''
  if (!identityReady.value) {
    persisted.value = false
    message.value = '当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。'
    return
  }
  const response = await sendToBackground({ type: MessageType.SaveTask, payload: { task: task as unknown as Record<string, unknown> } })
  const saved = response?.type === MessageType.TaskResult && response.payload.ok
  persisted.value = saved
  message.value = saved ? '计划已保存。没有发出写请求。' : response?.type === MessageType.TaskResult ? response.payload.message : '任务保存失败。'
  if (saved) {
    await reload()
    await useWorkspace().call({ action: 'load' })
  }
}

async function recheck(): Promise<void> {
  if (!checked.value) return
  checked.value = validateTask(checked.value, currentInput())
  message.value = checked.value.status === 'UNKNOWN' ? '结果未知，只做只读核对，没有改回可执行。' : checked.value.status === 'STALE' ? '当前文件或规则内容已经变化，旧计划不能继续。' : '已按当前配置重新核对。'
}

async function openHistory(item: TaskSummary): Promise<void> {
  if (!identityReady.value) return
  const response = await sendToBackground({
    type: MessageType.GetTask,
    payload: { origin: props.businessOrigin, operatorId: props.userId, taskId: item.taskId }
  })
  if (response?.type !== MessageType.TaskResult || !response.payload.task) {
    message.value = '没有读到这个任务。'
    return
  }
  const task = validateTask(response.payload.task as unknown as AutomationTask, currentInput())
  checked.value = task
  persisted.value = true
  selectedItem.value = task.items[0]?.itemId ?? ''
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
    <p v-if="!identityReady" class="hint">当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。</p>
    <p class="hint">现场只读验收：{{ acceptance.status }}。{{ acceptance.reason }}</p>
    <p class="hint">写门禁保持关闭。静态契约目录不能手动改成已验证。</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <ul v-if="history.length">
      <li v-for="item in history" :key="item.taskId">
        <button type="button" class="text-button" @click="openHistory(item)">{{ item.taskId }} · {{ item.customerName || '未绑定' }} · 文件 {{ item.fileCount }} · 邮件 {{ item.mailCount }} · {{ item.status }} · 创建 {{ item.createdAt }} · 核对 {{ item.verifiedAt || item.updatedAt }}</button>
      </li>
    </ul>
    <article v-if="checked" class="file-card">
      <strong>{{ checked.name }}</strong>
      <p class="hint">{{ persisted ? '已保存' : '未保存' }} · 任务 {{ checked.taskId }}</p>
      <p v-if="checked.legacyTaskId" class="hint">由旧编号 {{ checked.legacyTaskId }} 迁移，原记录保留在迁移关系里。</p>
      <p class="hint">客户 {{ customerLabel }} · 文件 {{ checked.selectedFiles.length }} · 预计邮件 {{ checked.items.length }}</p>
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
      <ul v-if="blockedPlans.length">
        <li v-for="plan in blockedPlans" :key="plan.stage + plan.itemId" class="hint">{{ plan.stage }} · {{ plan.contractStatus }} · {{ plan.blockers[0] }}</li>
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
