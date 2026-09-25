<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { productionWriteAllowed } from '../automation/contract-capture'
import { runDryRun } from '../automation/dry-run'
import { LIVE_EASY_ACCEPTANCE } from '../automation/easy-acceptance'
import { createBrowserTaskStore } from '../automation/indexed-store'
import { exportDiagnostic } from '../automation/logger'
import { recoverTask } from '../automation/recovery'
import { buildStagePlans } from '../automation/stage-plan'
import { AutomationTaskService } from '../automation/task-service'
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

const service = new AutomationTaskService(createBrowserTaskStore())
const history = ref<AutomationTask[]>([])
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

function currentInput() {
  return {
    origin: location.origin,
    operatorId: props.userId || 'session',
    files: props.files,
    rules: props.rules,
    profiles: props.profiles,
    queryTemplateVersion: props.queryTemplateVersion
  }
}

async function reload(): Promise<void> {
  history.value = await service.listTasks(location.origin, props.userId || 'session')
}

onMounted(() => { void reload() })

async function plan(): Promise<void> {
  const input = currentInput()
  const result = runDryRun(input, null)
  if (result.writeCalls.length > 0 || result.plans.some(item => item.sideEffect === 'write' && item.canExecute) || productionWriteAllowed()) {
    message.value = '计划包含写请求，已停止。'
    return
  }
  const task = service.validateTask(result.task, input)
  const saved = await service.saveTask(task)
  persisted.value = saved.ok
  checked.value = task
  selectedItem.value = result.task.items[0]?.itemId ?? ''
  message.value = saved.ok ? '计划已保存。没有发出写请求。' : saved.message
  if (saved.ok) await reload()
}

async function recheck(): Promise<void> {
  if (!checked.value) return
  checked.value = service.validateTask(checked.value, currentInput())
  message.value = checked.value.status === 'UNKNOWN' ? '结果未知，只做只读核对，没有改回可执行。' : checked.value.status === 'STALE' ? '当前文件或规则内容已经变化，旧计划不能继续。' : '已按当前配置重新核对。'
}

function openHistory(task: AutomationTask): void {
  checked.value = service.validateTask(task, currentInput())
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
    <p class="hint">现场只读验收：{{ acceptance.status }}。{{ acceptance.reason }}</p>
    <p class="hint">写门禁保持关闭。静态契约目录不能手动改成已验证。</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <ul v-if="history.length">
      <li v-for="item in history" :key="item.taskId">
        <button type="button" class="text-button" @click="openHistory(item)">{{ item.taskId }} · {{ item.customerName || '未绑定' }} · 文件 {{ item.selectedFiles.length }} · 邮件 {{ item.items.length }} · {{ item.status }} · 创建 {{ item.createdAt }} · 核对 {{ item.verifiedAt || item.updatedAt }}</button>
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
