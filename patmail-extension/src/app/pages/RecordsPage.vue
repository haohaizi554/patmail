<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import { PROCESS_SPECS, type ProcessKind, type ProcessListRow } from '../../api/mail-process'
import { describeTaskRecord } from '../record-status'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, tasks } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const specs = [PROCESS_SPECS.AP, PROCESS_SPECS.CO, PROCESS_SPECS.EF]
const kind = ref<ProcessKind>('AP')
const rows = ref<ProcessListRow[]>([])
const columns = computed(() => PROCESS_SPECS[kind.value].columns)
const total = ref(0)
const totals = ref<Partial<Record<ProcessKind, number>>>({})
const page = ref(1)
const pageSize = 10
const query = ref('')
const message = ref('')
const loading = ref(false)

interface ListSlot {
  searchKey: string
  page: number
  rows: ProcessListRow[]
  total: number
}

const slots = ref<Partial<Record<ProcessKind, ListSlot>>>({})
const pending = new Map<string, Promise<string>>()
let viewEpoch = 0

const placeholders: Record<ProcessKind, string> = {
  AP: '搜索提案名称、客户或文号',
  EF: '搜索文号、客户或案件',
  CO: '搜索主题、客户或收件人'
}
const staleBackground = computed(() => message.value.includes('没有接住转发'))

function reloadExtension(): void {
  const runtime = (globalThis as { chrome?: { runtime?: { reload?: () => void } } }).chrome?.runtime
  if (typeof runtime?.reload === 'function') {
    runtime.reload()
    return
  }
  message.value = '当前页面不能直接重载扩展。请到扩展管理页重新加载 PatMail。'
}

function textFor(code: string, fallback: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'HTTP_ERROR') return 'EASY 暂时没有返回，可以再查一次。'
  return fallback || '读取失败，请稍后重试。'
}

function remember(target: ProcessKind, searchKey: string, nextPage: number, listRows: ProcessListRow[], listTotal: number): void {
  slots.value = { ...slots.value, [target]: { searchKey, page: nextPage, rows: listRows, total: listTotal } }
  totals.value = { ...totals.value, [target]: listTotal }
  if (kind.value !== target || query.value.trim() !== searchKey) return
  rows.value = listRows
  total.value = listTotal
  page.value = nextPage
  message.value = ''
}

function showCached(target: ProcessKind, searchKey: string, nextPage: number): boolean {
  const slot = slots.value[target]
  if (!slot || slot.searchKey !== searchKey || slot.page !== nextPage) return false
  rows.value = slot.rows
  total.value = slot.total
  page.value = slot.page
  message.value = ''
  loading.value = false
  return true
}

async function fetchList(target: ProcessKind, nextPage: number, searchKey: string): Promise<string> {
  const key = `${target}\0${searchKey}\0${nextPage}`
  const existing = pending.get(key)
  if (existing) return existing
  const job = requestList(target, nextPage, searchKey).finally(() => {
    if (pending.get(key) === job) pending.delete(key)
  })
  pending.set(key, job)
  return job
}

async function requestList(target: ProcessKind, nextPage: number, searchKey: string): Promise<string> {
  if (!bridge || !ready.value) return '尚未连接 EASY。'
  const response = await bridge.request({
    type: MessageType.ListMailProcesses,
    payload: { query: { kind: target, searchKey, pageIndex: nextPage, pageSize } }
  })
  const visible = () => kind.value === target && query.value.trim() === searchKey
  if (response.type === MessageType.Error) {
    if (visible()) message.value = response.payload.message
    return response.payload.message
  }
  if (response.type !== MessageType.ListMailProcessesResult) {
    const text = '流程列表返回了意外结果。'
    if (visible()) message.value = text
    return text
  }
  if (!response.payload.ok) {
    const text = textFor(response.payload.error.code, response.payload.error.message)
    if (visible()) message.value = text
    return text
  }
  if (response.payload.data.kind !== target) {
    const text = '流程列表类型和当前页签不一致。'
    if (visible()) message.value = text
    return text
  }
  remember(target, searchKey, response.payload.data.pageIndex, response.payload.data.items, response.payload.data.total)
  return ''
}

function switchKind(next: ProcessKind): void {
  if (kind.value === next) return
  kind.value = next
  void load(1, false)
}

async function openRow(row: ProcessListRow): Promise<void> {
  if (!bridge || !row.open) {
    message.value = '这条记录没有原站打开所需的编号。'
    return
  }
  message.value = ''
  const response = await bridge.request({ type: MessageType.OpenEasyForm, payload: { target: row.open } })
  if (response.type === MessageType.Error) {
    message.value = response.payload.message
    return
  }
  if (response.type !== MessageType.OpenEasyFormResult) {
    message.value = '打开请求没有得到结果。'
    return
  }
  message.value = response.payload.message
  if (!response.payload.ok) return
  const tabId = connection.value.easyTabId
  const tabs = (globalThis as { chrome?: { tabs?: { update?: (id: number, properties: { active: boolean }) => Promise<unknown> } } }).chrome?.tabs
  if (tabId != null && typeof tabs?.update === 'function') await tabs.update(tabId, { active: true })
}

async function load(nextPage = page.value, force = true): Promise<void> {
  if (!bridge || !ready.value) {
    message.value = '尚未连接 EASY。'
    return
  }
  const epoch = ++viewEpoch
  const searchKey = query.value.trim()
  if (!force && showCached(kind.value, searchKey, nextPage)) return
  loading.value = true
  message.value = ''
  await fetchList(kind.value, nextPage, searchKey)
  if (viewEpoch === epoch) loading.value = false
}

async function loadAll(): Promise<void> {
  if (!bridge || !ready.value) {
    message.value = '尚未连接 EASY。'
    return
  }
  const epoch = ++viewEpoch
  const searchKey = query.value.trim()
  loading.value = true
  message.value = ''
  const current = kind.value
  await Promise.all(specs.map(spec => fetchList(spec.kind, 1, searchKey).then(() => {
    if (viewEpoch === epoch && spec.kind === current) loading.value = false
  })))
  if (viewEpoch === epoch) loading.value = false
}

watch(ready, (ok) => {
  if (!ok) {
    slots.value = {}
    totals.value = {}
    rows.value = []
    total.value = 0
    return
  }
  void loadAll()
}, { immediate: true })
</script>

<template>
  <PageHead title="发文记录" desc="记录每一次专业的发送，让专利服务更透明、更可追溯。" :art="bg('靠近成功的一步.png')" />
  <section class="card">
    <div class="tabs">
      <button v-for="spec in specs" :key="spec.kind" type="button" :class="{ on: kind === spec.kind }" @click="switchKind(spec.kind)">
        {{ spec.label }}<small v-if="totals[spec.kind] != null"> ({{ totals[spec.kind] }})</small>
      </button>
    </div>
    <p class="hint">列表来自 EASY 待办流程。这里只读取，不会提交或结束流程。</p>
    <div class="filters">
      <label class="grow"><input v-model="query" :placeholder="placeholders[kind]" @keydown.enter="load(1)" /></label>
      <button type="button" class="ghost" :disabled="loading" @click="load(1)">{{ loading ? '查询中' : '查询' }}</button>
      <button type="button" class="ghost" :disabled="loading || !ready" @click="load(page)">刷新</button>
    </div>
    <p v-if="!ready" class="empty">尚未确认 EASY 用户。</p>
    <p v-else-if="message" class="hint">{{ message }}</p>
    <p v-if="staleBackground" class="hint">三个页签都会带上流程类型。正在运行的后台还是移动列表之前的版本，所以会整条拒绝。</p>
    <button v-if="staleBackground" type="button" class="solid" @click="reloadExtension">重新加载扩展</button>
    <p v-else-if="!loading && rows.length === 0" class="empty">暂无记录</p>
    <table v-if="ready && rows.length" class="grid">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key">{{ column.label }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="row.id || kind + index">
          <td v-for="column in columns" :key="column.key">{{ row.cells[column.key] || '—' }}</td>
          <td><button type="button" class="ghost" @click="openRow(row)">打开</button></td>
        </tr>
      </tbody>
    </table>
    <div v-if="total > pageSize" class="pager">
      <span>共 {{ total }} 条</span>
      <div>
        <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
        <button type="button" class="on">{{ page }}</button>
        <button type="button" :disabled="page * pageSize >= total || loading" @click="load(page + 1)">下一页</button>
      </div>
    </div>
  </section>
  <section class="card">
    <h2>本地任务记录</h2>
    <p class="hint">记录从已保存任务推导。没有发送核验时，不会显示已成功发送。</p>
    <p v-if="!ready || tasks.length === 0" class="empty">暂无记录</p>
    <table v-else class="grid">
      <thead><tr><th>时间</th><th>客户</th><th>状态</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.taskId">
          <td>{{ task.updatedAt || task.createdAt }}</td>
          <td>{{ task.customerName || '未命名' }}</td>
          <td>{{ task.status }}</td>
          <td>{{ describeTaskRecord(task.status) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
