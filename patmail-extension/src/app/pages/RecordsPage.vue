<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import { PROCESS_SPECS, type ProcessKind, type ProcessListRow } from '../../api/mail-process'
import { filterProcessRows } from '../../api/process-list-search'
import { describeTaskRecord } from '../record-status'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'
import EmptyGuide from '../components/EmptyGuide.vue'

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
const catalogSize = 100
const catalogCap = 1000
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
const catalogs = new Map<ProcessKind, { rows: ProcessListRow[], total: number }>()
const catalogEpoch = new Map<ProcessKind, number>()
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

async function readPage(target: ProcessKind, nextPage: number, size: number): Promise<{ ok: true, items: ProcessListRow[], total: number, pageIndex: number } | { ok: false, message: string }> {
  if (!bridge || !ready.value) return { ok: false, message: '尚未连接 EASY。' }
  const response = await bridge.request({
    type: MessageType.ListMailProcesses,
    payload: { query: { kind: target, searchKey: '', pageIndex: nextPage, pageSize: size } }
  })
  if (response.type === MessageType.Error) return { ok: false, message: response.payload.message }
  if (response.type !== MessageType.ListMailProcessesResult) return { ok: false, message: '流程列表返回了意外结果。' }
  if (!response.payload.ok) return { ok: false, message: textFor(response.payload.error.code, response.payload.error.message) }
  if (response.payload.data.kind !== target) return { ok: false, message: '流程列表类型和当前页签不一致。' }
  return { ok: true, items: response.payload.data.items, total: response.payload.data.total, pageIndex: response.payload.data.pageIndex }
}

async function requestList(target: ProcessKind, nextPage: number, searchKey: string): Promise<string> {
  const pageResult = await readPage(target, nextPage, pageSize)
  const visible = () => kind.value === target && query.value.trim() === searchKey
  if (!pageResult.ok) {
    if (visible()) message.value = pageResult.message
    return pageResult.message
  }
  remember(target, searchKey, pageResult.pageIndex, pageResult.items, pageResult.total)
  return ''
}

async function fillCatalog(target: ProcessKind, epoch: number): Promise<string> {
  const first = await readPage(target, 1, catalogSize)
  if (catalogEpoch.get(target) !== epoch) return ''
  if (!first.ok) return first.message
  const listRows = [...first.items]
  let index = 2
  while (listRows.length < first.total && listRows.length < catalogCap) {
    const next = await readPage(target, index, catalogSize)
    if (catalogEpoch.get(target) !== epoch) return ''
    if (!next.ok) return next.message
    if (next.items.length === 0) break
    listRows.push(...next.items)
    index += 1
  }
  if (catalogEpoch.get(target) !== epoch) return ''
  catalogs.set(target, { rows: listRows, total: first.total })
  totals.value = { ...totals.value, [target]: first.total }
  return ''
}

async function ensureCatalog(target: ProcessKind, force: boolean): Promise<string> {
  if (!force && catalogs.has(target)) return ''
  const epoch = (catalogEpoch.get(target) ?? 0) + 1
  catalogEpoch.set(target, epoch)
  catalogs.delete(target)
  return fillCatalog(target, epoch)
}

function showMatches(target: ProcessKind, searchKey: string, nextPage: number): void {
  const catalog = catalogs.get(target)
  if (!catalog || kind.value !== target || query.value.trim() !== searchKey) return
  const matched = filterProcessRows(catalog.rows, target, searchKey)
  const lastPage = Math.max(1, Math.ceil(matched.length / pageSize))
  const safePage = Math.min(Math.max(1, nextPage), lastPage)
  rows.value = matched.slice((safePage - 1) * pageSize, safePage * pageSize)
  total.value = matched.length
  page.value = safePage
  totals.value = { ...totals.value, [target]: catalog.total }
  const matchedText = `匹配到 ${matched.length} 条。`
  message.value = catalog.rows.length < catalog.total
    ? `${matchedText}这一页签共 ${catalog.total} 条，这次只读了前 ${catalog.rows.length} 条。`
    : matchedText
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
  const target = kind.value
  if (searchKey) {
    loading.value = true
    message.value = ''
    rows.value = []
    total.value = 0
    const error = await ensureCatalog(target, force)
    if (viewEpoch !== epoch || kind.value !== target || query.value.trim() !== searchKey) {
      if (viewEpoch === epoch) loading.value = false
      return
    }
    if (error) {
      message.value = error
      loading.value = false
      return
    }
    showMatches(target, searchKey, nextPage)
    loading.value = false
    return
  }
  if (!force && showCached(target, '', nextPage)) return
  loading.value = true
  message.value = ''
  await fetchList(target, nextPage, '')
  if (viewEpoch === epoch) loading.value = false
}

async function loadAll(): Promise<void> {
  if (!bridge || !ready.value) {
    message.value = '尚未连接 EASY。'
    return
  }
  const epoch = ++viewEpoch
  loading.value = true
  message.value = ''
  const current = kind.value
  const currentPage = query.value.trim() ? 1 : page.value
  await Promise.all(specs.map(spec => fetchList(spec.kind, spec.kind === current ? currentPage : 1, '')))
  if (viewEpoch !== epoch) return
  if (query.value.trim()) {
    await load(1, true)
    return
  }
  loading.value = false
}

watch(ready, (ok) => {
  if (!ok) {
    slots.value = {}
    totals.value = {}
    catalogs.clear()
    catalogEpoch.clear()
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
    <p class="hint">列表来自 EASY 待办流程。搜索会先读完当前页签，再在本地匹配：发文看主题、客户和收件人，提案看名称、客户和文号，递交看文号、客户和案件。</p>
    <div class="filters">
      <label class="grow"><input v-model="query" :placeholder="placeholders[kind]" @keydown.enter="load(1)" /></label>
      <button type="button" class="ghost" :disabled="loading" @click="load(1)">{{ loading ? '查询中' : '查询' }}</button>
      <button type="button" class="ghost" :disabled="loading || !ready" @click="loadAll">刷新</button>
    </div>
    <p v-if="!ready" class="empty">尚未确认 EASY 用户。</p>
    <p v-else-if="message" class="hint">{{ message }}</p>
    <p v-if="staleBackground" class="hint">三个页签都会带上流程类型。正在运行的后台还是移动列表之前的版本，所以会整条拒绝。</p>
    <button v-if="staleBackground" type="button" class="solid" @click="reloadExtension">重新加载扩展</button>
    <p v-else-if="!loading && !message && rows.length === 0" class="empty">{{ query.trim() ? '当前页签里没有匹配到这个词。' : '这次没有查到待办。换个条件再查，或点刷新。' }}</p>
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
        <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1, !query.trim())">上一页</button>
        <button type="button" class="on">{{ page }}</button>
        <button type="button" :disabled="page * pageSize >= total || loading" @click="load(page + 1, !query.trim())">下一页</button>
      </div>
    </div>
  </section>
  <section class="card">
    <h2>本地任务记录</h2>
    <p class="hint">记录从已保存任务推导。没有发送核验时，不会显示已成功发送。</p>
    <p v-if="!ready" class="empty">还没确认当前登录的人，本地记录先不显示。</p>
    <EmptyGuide v-else-if="tasks.length === 0" text="还没有本地发文任务。去发文任务里拼一封之后，记录会出现在这里。" action="去发文任务" hash="/tasks" />
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
