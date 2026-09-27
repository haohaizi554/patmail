<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { bg } from '../../../../src/assets'
import type { MailProcessRow } from '../../api/mail-process'
import type { PatentFile } from '../../api/file-search-types'
import type { CustomerQueryProfile } from '../../customer/types'
import { assembleMail, fillFromRules } from '../../mail'
import type { AssembledMail } from '../../mail/assemble'
import type { SelectedPatentFile } from '../../mail/types'
import { describeItemRecord, describeTaskRecord } from '../record-status'
import { MessageType, type MessageBridge } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, rules, tasks, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const detail = ref<Record<string, unknown> | null>(null)
const detailMessage = ref('')
const evidenceMessage = ref('')

const processRows = ref<MailProcessRow[]>([])
const processTotal = ref(0)
const processPage = ref(1)
const processSize = 10
const processQuery = ref('')
const processMessage = ref('')
const processLoading = ref(false)
const openedSubject = ref('')
const openedFiles = ref<string[]>([])
const openedNote = ref('')

const mailTypes = ref<Array<{ id: string; name: string }>>([])
const fileKeyword = ref('')
const fileHits = ref<PatentFile[]>([])
const fileMessage = ref('')
const fileLoading = ref(false)
const picked = ref<SelectedPatentFile[]>([])
const customerId = ref('')
const mailTypeId = ref('')
const draftTo = ref('')
const draftCc = ref('')
const draftSubject = ref('')
const draftBody = ref('')
const fillNotes = ref<string[]>([])
const preview = ref<AssembledMail | null>(null)

const customer = computed(() => customers.value.find(item => item.id === customerId.value) ?? null)
const mailTypeName = computed(() => mailTypes.value.find(item => item.id === mailTypeId.value)?.name ?? '')

async function openTask(taskId: string): Promise<void> {
  const response = await sendToBackground({
    type: MessageType.GetTask,
    payload: { origin: connection.value.easyOrigin, operatorId: connection.value.operatorId, taskId }
  })
  if (!response || response.type !== MessageType.TaskResult || !response.payload.task) {
    detailMessage.value = response?.type === MessageType.Error ? response.payload.message : '没有读取到任务。'
    detail.value = null
    evidenceMessage.value = ''
    return
  }
  detail.value = response.payload.task
  detailMessage.value = ''
  const evidence = response.payload.currentEvidence
  evidenceMessage.value = evidence && typeof evidence === 'object' && evidence.requiresRevalidation === true && typeof evidence.message === 'string' ? evidence.message : ''
}

const items = computed(() => Array.isArray(detail.value?.items) ? detail.value.items as Array<Record<string, unknown>> : [])
const ruleRevision = computed(() => {
  const snapshot = detail.value?.ruleSnapshot
  return snapshot && typeof snapshot === 'object' && 'revision' in snapshot ? String((snapshot as { revision?: unknown }).revision ?? '') : ''
})
const identities = computed(() => Array.isArray(detail.value?.identitySnapshot) ? detail.value.identitySnapshot as Array<Record<string, unknown>> : [])
const issues = computed(() => Array.isArray(detail.value?.issues) ? detail.value.issues as Array<Record<string, unknown>> : [])
function draftSubjectOf(item: Record<string, unknown>): string {
  const row = item.mailDraftPreview
  if (!row || typeof row !== 'object') return ''
  return String((row as { subject?: unknown }).subject ?? '')
}

function textFor(code: string, fallback: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'HTTP_ERROR') return 'EASY 暂时没有返回，可以再查一次。'
  return fallback || '读取失败，请稍后重试。'
}

async function loadProcesses(page = processPage.value): Promise<void> {
  if (!bridge || !ready.value) {
    processMessage.value = '尚未连接 EASY。'
    return
  }
  processLoading.value = true
  processMessage.value = ''
  try {
    const response = await bridge.request({
      type: MessageType.ListMailProcesses,
      payload: { query: { searchKey: processQuery.value.trim(), pageIndex: page, pageSize: processSize } }
    })
    if (response.type === MessageType.Error) {
      processMessage.value = response.payload.message
      return
    }
    if (response.type !== MessageType.ListMailProcessesResult) {
      processMessage.value = '发文列表返回了意外结果。'
      return
    }
    if (!response.payload.ok) {
      processMessage.value = textFor(response.payload.error.code, response.payload.error.message)
      return
    }
    processRows.value = response.payload.data.items
    processTotal.value = response.payload.data.total
    processPage.value = response.payload.data.pageIndex
  } finally {
    processLoading.value = false
  }
}

async function openProcess(row: MailProcessRow): Promise<void> {
  openedSubject.value = row.subject || '未命名发文'
  openedFiles.value = []
  openedNote.value = ''
  if (!row.mailId || !bridge) {
    openedNote.value = '这条记录没有邮件编号，不能继续读取。'
    return
  }
  openedNote.value = '正在读取这封发文…'
  const response = await bridge.request({
    type: MessageType.DiagnoseExistingMail,
    payload: { mailId: row.mailId, flowType: 'CO' }
  })
  if (response.type === MessageType.Error) {
    openedNote.value = response.payload.message
    return
  }
  if (response.type !== MessageType.ExistingMailDiagnostic) {
    openedNote.value = '发文详情返回了意外结果。'
    return
  }
  openedFiles.value = response.payload.fileNames
  openedNote.value = response.payload.blockers.filter(Boolean).join('；')
}

async function loadMailTypes(): Promise<void> {
  if (!bridge || !ready.value) return
  const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'mailType', force: false } })
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'mailType') return
  const nodes = response.payload.data.nodes
  const leaves = nodes.filter(node => !nodes.some(other => other.parentId === node.id))
  mailTypes.value = (leaves.length ? leaves : nodes).map(node => ({ id: node.id, name: node.name }))
}

async function searchFiles(): Promise<void> {
  if (!bridge || !ready.value) {
    fileMessage.value = '尚未连接 EASY。'
    return
  }
  if (!customer.value?.name.trim() && !fileKeyword.value.trim()) {
    fileMessage.value = '先选择客户，或填写文件名。'
    return
  }
  fileLoading.value = true
  fileMessage.value = ''
  try {
    const response = await bridge.request({
      type: MessageType.SearchFiles,
      payload: {
        query: {
          customerName: customer.value?.name ?? '',
          fileName: fileKeyword.value.trim(),
          pageIndex: 1,
          pageSize: 10
        }
      }
    })
    if (response.type === MessageType.Error) {
      fileMessage.value = response.payload.message
      return
    }
    if (response.type !== MessageType.SearchFilesResult) {
      fileMessage.value = '文件查询返回了意外结果。'
      return
    }
    if (!response.payload.ok) {
      fileMessage.value = textFor(response.payload.error.code, response.payload.error.message)
      return
    }
    fileHits.value = response.payload.data.items
    if (fileHits.value.length === 0) fileMessage.value = '没有查到文件。'
  } finally {
    fileLoading.value = false
  }
}

function toggleFile(file: PatentFile): void {
  const exists = picked.value.some(item => item.fileId === file.fileId)
  picked.value = exists
    ? picked.value.filter(item => item.fileId !== file.fileId)
    : picked.value.concat({
      fileId: file.fileId,
      fileName: file.fileName,
      fileDescription: file.fileDescription ?? '',
      customerName: file.customerName ?? customer.value?.name ?? '',
      caseId: file.caseId,
      caseVolume: file.caseVolume,
      applicationNo: file.applicationNo
    })
  preview.value = null
}

function applyRules(): void {
  const current = customer.value
  if (!current) {
    fillNotes.value = ['先选择客户，再带入这个客户的规则。']
    return
  }
  const filled = fillFromRules(current, picked.value, rules.value, connection.value.operatorId)
  draftTo.value = filled.to
  draftCc.value = filled.cc
  draftSubject.value = filled.subject
  draftBody.value = filled.body
  if (filled.mailTypeId && mailTypes.value.some(item => item.id === filled.mailTypeId)) mailTypeId.value = filled.mailTypeId
  fillNotes.value = filled.notes
  preview.value = null
}

function buildPreview(): void {
  preview.value = assembleMail({
    customer: customer.value,
    mailTypeId: mailTypeId.value,
    mailTypeName: mailTypeName.value,
    files: picked.value,
    reviewer: rules.value?.defaultReviewer ?? null,
    to: draftTo.value,
    cc: draftCc.value,
    subject: draftSubject.value,
    body: draftBody.value
  })
}

function customerOptions(rows: CustomerQueryProfile[]): Array<{ value: string; label: string }> {
  return [{ value: '', label: '选择客户' }, ...rows.map(item => ({ value: item.id, label: item.name }))]
}

watch(ready, (ok) => {
  if (!ok) return
  void loadProcesses(1)
  void loadMailTypes()
}, { immediate: true })
onMounted(() => { if (ready.value) void call({ action: 'load' }) })
</script>

<template>
  <PageHead title="发文任务" desc="高效执行专利发文任务，让重要文件准时送达！" :art="bg('创业路上的小胜利.png')" />
  <section v-if="!ready" class="card"><p class="empty">尚未确认 EASY 用户。刷新页面后也不会加载其他账号的任务。</p></section>
  <template v-else>
    <section class="card">
      <div class="card-head"><h2>进行中的发文</h2></div>
      <p class="hint">列表来自 EASY 发文流程。这里只读取，不会提交或结束流程。</p>
      <div class="filters">
        <label class="grow"><input v-model="processQuery" placeholder="搜索主题、客户或收件人" @keydown.enter="loadProcesses(1)" /></label>
        <button type="button" class="ghost" :disabled="processLoading" @click="loadProcesses(1)">{{ processLoading ? '查询中' : '查询' }}</button>
      </div>
      <p v-if="processMessage" class="hint">{{ processMessage }}</p>
      <p v-else-if="!processLoading && processRows.length === 0" class="empty">暂无发文</p>
      <table v-if="processRows.length" class="grid">
        <thead><tr><th>客户</th><th>主题</th><th>发文类型</th><th>收件人</th><th>节点</th><th>更新时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in processRows" :key="row.mailId || row.subject + row.updatedAt">
            <td>{{ row.customerName || '—' }}</td>
            <td>{{ row.subject || '未命名发文' }}</td>
            <td>{{ row.mailType }}</td>
            <td>{{ row.mailTo }}</td>
            <td>{{ row.nodeName }}</td>
            <td>{{ row.updatedAt }}</td>
            <td><button type="button" class="ghost" @click="openProcess(row)">打开</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="processTotal > processSize" class="pager">
        <span>共 {{ processTotal }} 条</span>
        <div>
          <button type="button" :disabled="processPage <= 1 || processLoading" @click="loadProcesses(processPage - 1)">上一页</button>
          <button type="button" class="on">{{ processPage }}</button>
          <button type="button" :disabled="processPage * processSize >= processTotal || processLoading" @click="loadProcesses(processPage + 1)">下一页</button>
        </div>
      </div>
      <p v-if="openedSubject" class="hint">{{ openedSubject }}<template v-if="openedFiles.length"> · 文件 {{ openedFiles.join('、') }}</template></p>
      <p v-if="openedNote" class="hint">{{ openedNote }}</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>拼一封发文</h2></div>
      <p class="hint">创建任务是把客户、文件、发文类型和已保存规则自己拼起来。这一步只生成预览，不会在 EASY 创建邮件。</p>
      <div class="form-grid">
        <label>客户<ThemeSelect v-model="customerId" :options="customerOptions(customers)" /></label>
        <label>发文类型<ThemeSelect v-model="mailTypeId" :options="[{ value: '', label: '选择发文类型' }, ...mailTypes.map(item => ({ value: item.id, label: item.name }))]" /></label>
        <label>文件名<input v-model="fileKeyword" placeholder="可按文件名缩小范围" @keydown.enter="searchFiles" /></label>
      </div>
      <div class="filters">
        <button type="button" class="ghost" :disabled="fileLoading" @click="searchFiles">{{ fileLoading ? '查找中' : '查找文件' }}</button>
        <button type="button" class="ghost" @click="applyRules">带入这个客户的规则</button>
        <button type="button" class="solid" @click="buildPreview">拼成预览</button>
      </div>
      <p v-if="fileMessage" class="hint">{{ fileMessage }}</p>
      <p v-for="note in fillNotes" :key="note" class="hint">{{ note }}</p>
      <table v-if="fileHits.length" class="grid">
        <thead><tr><th></th><th>文件</th><th>客户</th><th>我方文号</th></tr></thead>
        <tbody>
          <tr v-for="file in fileHits" :key="file.fileId">
            <td><input type="checkbox" :checked="picked.some(item => item.fileId === file.fileId)" @change="toggleFile(file)" /></td>
            <td>{{ file.fileName }}</td>
            <td>{{ file.customerName }}</td>
            <td>{{ file.caseVolume }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="picked.length" class="hint">已选 {{ picked.length }} 个文件：{{ picked.map(item => item.fileName).join('、') }}</p>
      <div class="form-grid composer">
        <label>收件人<input v-model="draftTo" placeholder="多个地址用分号分开" /></label>
        <label>抄送<input v-model="draftCc" /></label>
        <label>主题<input v-model="draftSubject" /></label>
      </div>
      <label class="composer">正文<textarea v-model="draftBody" /></label>
      <section v-if="preview" class="card inset">
        <h2>预览</h2>
        <p v-if="preview.gaps.length" class="hint">还缺：{{ preview.gaps.join('') }}</p>
        <p class="hint">客户 {{ preview.customerName || '未选' }} · 类型 {{ preview.mailTypeName || '未选' }} · 文件 {{ preview.fileNames.join('、') || '未选' }}</p>
        <p class="hint">收件人 {{ preview.to || '空' }} · 抄送 {{ preview.cc || '空' }}</p>
        <p class="hint">主题 {{ preview.subject || '空' }} · 审核人 {{ preview.reviewerName || '未设默认' }}</p>
        <p class="hint">{{ preview.body || '正文还是空的。' }}</p>
      </section>
    </section>

    <section class="card">
      <h2>本地计划</h2>
      <p class="hint">这些计划保存在扩展里，和上面从 EASY 读到的发文不是同一份列表。</p>
      <p v-if="tasks.length === 0" class="empty">暂无任务</p>
      <table v-else class="grid">
        <thead><tr><th>客户</th><th>文件</th><th>预计邮件</th><th>状态</th><th>记录</th><th></th></tr></thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.taskId">
            <td>{{ task.customerName || '未命名' }}</td>
            <td>{{ task.fileCount }}</td>
            <td>{{ task.mailCount }}</td>
            <td>{{ task.status }}</td>
            <td>{{ describeTaskRecord(task.status) }}</td>
            <td><button type="button" class="ghost" :aria-label="`${task.taskId} 详情`" @click="openTask(task.taskId)">详情</button></td>
          </tr>
        </tbody>
      </table>
    </section>
    <section v-if="detail" class="card">
      <h2>任务详情</h2>
      <p v-if="evidenceMessage" class="hint" role="status">{{ evidenceMessage }}</p>
      <p class="hint">来源 Origin {{ String(detail.origin ?? '') }} · {{ String(detail.taskId) }} · {{ describeTaskRecord(String(detail.status ?? '')) }}</p>
      <p class="hint">客户 {{ String(detail.customerName ?? '') }} · 规则版本 {{ ruleRevision }} · 文件 {{ Array.isArray(detail.selectedFiles) ? detail.selectedFiles.length : 0 }} · 阶段 {{ String(detail.status ?? '') }}</p>
      <p v-if="issues.length" class="hint">阻塞：{{ issues.map(item => String(item.message ?? '')).filter(Boolean).join('；') }}</p>
      <ul v-if="identities.length" class="hint">
        <li v-for="row in identities" :key="String(row.profileId) + String(row.easyCustomerId)">配置 {{ row.profileName || row.profileId }} · EASY 客户 {{ row.easyCustomerId || '未绑定 GUID' }} · 模板 {{ row.baseTemplateId || '无' }}</li>
      </ul>
      <p v-if="items.length === 0" class="empty">这个任务没有邮件条目。</p>
      <table v-else class="grid">
        <thead><tr><th>文件</th><th>发文类型</th><th>草稿主题</th><th>当前阶段</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="item in items" :key="String(item.itemId)">
            <td>{{ Array.isArray(item.fileNames) ? item.fileNames.join('、') : '' }}</td>
            <td>{{ item.mailTypeName || item.mailTypeId }}</td>
            <td>{{ draftSubjectOf(item) }}</td>
            <td>{{ item.status }}</td>
            <td>{{ describeItemRecord(String(item.status ?? ''), String(item.easyMailId ?? '')) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p v-if="detailMessage" class="hint">{{ detailMessage }}</p>
  </template>
</template>
