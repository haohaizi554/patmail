<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import LimitPage from '../../../../src/pages/LimitPage.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import BindQueryBar from '../components/BindQueryBar.vue'
import type { LimitMonitorResult, LimitMonitorRow } from '../../api/limit-monitor-types'
import { isLimitMonitorType, type LimitMonitorQuery } from '../../api/limit-monitor-params'
import { PENDING_CUSTOMER_KEY, applyBoundQuery, matchPctMailTypes, querySnapshot } from '../../customer/mail-flow'
import { fetchMailTypeNodes } from '../../customer/mail-type-load'
import { applyPctMailTypes, clonePctTask, pctRowsFromTable, summarizePctTask, volumesOf } from '../../customer/pct-sheet'
import { isPctTask } from '../../customer/guards'
import type { PctTaskDraft, PctTaskRow } from '../../customer/types'
import { joinCaseVolumes, splitCaseVolumes } from '../../customer/volume-list'
import { readXlsxRows } from '../../customer/xlsx-table'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, call } = useWorkspace()
const connected = computed(() => connection.value.sessionStatus === 'authenticated')
const loading = ref(false)
const savingTask = ref(false)
const message = ref('')
const rows = ref<LimitMonitorRow[]>([])
const total = ref(0)
const pageIndex = ref(1)
const pageSize = ref(10)
const selected = ref<string[]>([])
const confirmedIds = ref<string[]>([])
const templateId = ref('')
const seed = ref<Record<string, string> | null>(null)
const seedToken = ref(0)
const draftFields = ref<Record<string, string>>({})
const submittedFields = ref<Record<string, string>>({})
const sheetRows = ref<PctTaskRow[]>([])
const sheetNotice = ref('')
const mailNodes = ref<Array<{ id: string; name: string }>>([])
const mailTypeMessage = ref('正在从原网站读取发文类型…')
const mailMatch = computed(() => matchPctMailTypes(mailNodes.value))
const sheetMerged = ref(false)
const lastQuery = ref<Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> | null>(null)

const pctCustomer = computed(() => {
  const pending = sessionStorage.getItem(PENDING_CUSTOMER_KEY) || ''
  const marked = customers.value.filter(item => item.workflowId === 'pct-reminder' && item.querySurface === 'limit')
  return marked.find(item => item.id === pending) ?? marked[0] ?? null
})
const boundFields = computed(() => {
  const draft = querySnapshot(draftFields.value)
  if (Object.keys(draft).length) return draft
  return submittedFields.value
})
const sheetSummary = computed(() => {
  const named = sheetRows.value.filter(row => row.mailTypeLabel.trim())
  if (!named.length) return '发文类型还没从原网站读到。'
  const labels = [...new Set(named.map(row => row.mailTypeLabel))]
  return `发文类型：${labels.map(label => `${label} ${named.filter(row => row.mailTypeLabel === label).length} 件`).join('，')}。`
})
const shownPageSize = computed(() => sheetMerged.value ? Math.max(rows.value.length, 1) : pageSize.value)

function textFor(code: string, fallback: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'HTTP_ERROR') return 'EASY 暂时没有返回列表，可以再查一次。'
  if (code === 'INVALID_QUERY') return fallback || '请输入查询条件。'
  return fallback || '期限查询失败，请稍后重试。'
}

function remember(input: { caseVolume?: string; applicationNo?: string; customerName?: string; ctrlProcId?: string; fields?: Record<string, string> }): void {
  const snap = querySnapshot({
    ...(input.fields ?? {}),
    ...(input.caseVolume ? { case_volume: input.caseVolume } : {}),
    ...(input.applicationNo ? { app_no: input.applicationNo } : {}),
    ...(input.customerName ? { customer_name: input.customerName } : {}),
    ...(input.ctrlProcId ? { ctrl_proc: input.ctrlProcId } : {})
  })
  if (Object.keys(snap).length) submittedFields.value = snap
}

function selectedCtrl(): string {
  const ids = (draftFields.value.ctrl_proc ?? '').split(',').map(item => item.trim()).filter(Boolean)
  return ids.length > 0 && ids.every(item => isQueryGuid(item)) ? ids.join(',') : ''
}

async function requestPage(query: LimitMonitorQuery): Promise<LimitMonitorResult> {
  if (!bridge || !connected.value) throw '尚未连接 EASY。'
  const response = await bridge.request({ type: MessageType.SearchLimitMonitor, payload: { query } })
  if (response.type === MessageType.Error) throw response.payload.message
  if (response.type !== MessageType.SearchLimitMonitorResult) throw '期限查询返回了意外结果。'
  if (!response.payload.ok) throw textFor(response.payload.error.code, response.payload.error.message)
  return response.payload.data
}

async function search(input: { type: string; caseVolume?: string; applicationNo?: string; customerName?: string; ctrlProcId?: string; fields?: Record<string, string>; templateId?: string; reset?: boolean; page?: number }): Promise<void> {
  if (input.reset) {
    rows.value = []
    total.value = 0
    message.value = ''
    pageIndex.value = 1
    selected.value = []
    templateId.value = ''
    lastQuery.value = null
    submittedFields.value = {}
    sheetMerged.value = false
    return
  }
  if (!bridge || !connected.value) {
    message.value = '尚未连接 EASY。'
    return
  }
  if (!isLimitMonitorType(input.type)) {
    message.value = '这个页签还不能查询。'
    return
  }
  remember(input)
  const query = {
    type: input.type,
    caseVolume: input.caseVolume ?? '',
    applicationNo: input.applicationNo ?? '',
    customerName: input.customerName ?? '',
    ...(input.ctrlProcId ? { ctrlProcId: input.ctrlProcId } : {}),
    ...(input.fields ? { fields: input.fields } : {})
  }
  lastQuery.value = query
  if (input.templateId) templateId.value = input.templateId
  if (!input.page && splitCaseVolumes(query.caseVolume ?? '').length > 1) {
    await showCollected(query)
    return
  }
  if (!input.page) {
    selected.value = []
    sheetMerged.value = false
  }
  loading.value = true
  message.value = ''
  const targetPage = input.page ?? 1
  try {
    const data = await requestPage({ ...query, pageIndex: targetPage, pageSize: pageSize.value })
    rows.value = data.items
    total.value = data.total
    pageIndex.value = targetPage
    message.value = data.items.length ? '' : '这个条件下没有期限记录。'
  } catch (error) {
    message.value = typeof error === 'string' ? error : '期限查询失败，请重试。'
  } finally {
    loading.value = false
  }
}

async function showCollected(query: Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'>): Promise<void> {
  loading.value = true
  sheetMerged.value = true
  selected.value = []
  message.value = '正在按这些文号一起查询…'
  try {
    const first = await requestPage({ ...query, pageIndex: 1, pageSize: 100 })
    const items = [...first.items]
    const pages = Math.min(20, Math.ceil(first.total / 100))
    for (let page = 2; page <= pages; page += 1) {
      const next = await requestPage({ ...query, pageIndex: page, pageSize: 100 })
      items.push(...next.items)
    }
    rows.value = items
    total.value = items.length
    pageIndex.value = 1
    message.value = items.length ? `一起查完，共 ${items.length} 件。` : '这个条件下没有期限记录。'
  } catch (error) {
    message.value = typeof error === 'string' ? error : '期限查询失败，请重试。'
  } finally {
    loading.value = false
  }
}

function goPage(page: number): void {
  if (!lastQuery.value || loading.value || sheetMerged.value) return
  void search({ ...lastQuery.value, page })
}

function loadBound(fields: Record<string, string>): void {
  seedToken.value += 1
  seed.value = { ...fields }
}

function onSelect(ids: string[]): void {
  selected.value = ids
}

async function onConfirm(ids: string[]): Promise<void> {
  const procIds = ids.filter(item => isQueryGuid(item))
  confirmedIds.value = procIds
  const customer = pctCustomer.value
  if (!customer?.pctTask) {
    message.value = `已确认勾选 ${procIds.length} 件。创建任务时会带上这些处理事项，不会向 EASY 创建发文。`
    return
  }
  const scope = scopeFromConnection(connection.value)
  if (!scope) {
    message.value = `已确认勾选 ${procIds.length} 件。还没确认当前登录的人，没有写进任务。`
    return
  }
  const result = await call({
    action: 'saveCustomer',
    profile: JSON.parse(JSON.stringify({ ...customer, pctTask: clonePctTask({ ...customer.pctTask, confirmedProcIds: procIds }), updatedAt: new Date().toISOString() })),
    expectedScope: scope,
    expectedRevision: customer.revision ?? 1
  })
  message.value = result?.ok
    ? `已确认勾选 ${procIds.length} 件，并写进${customer.name}的 PCT 任务。不会向 EASY 创建发文。`
    : (result?.message || `已确认勾选 ${procIds.length} 件，但没有写进任务。`)
}

async function loadMailTypes(force: boolean): Promise<void> {
  if (!bridge || !connected.value) {
    mailNodes.value = []
    mailTypeMessage.value = '还没连接 EASY，发文类型还没读取。'
    return
  }
  mailTypeMessage.value = '正在从原网站读取发文类型…'
  const loaded = await fetchMailTypeNodes(bridge, force)
  mailNodes.value = loaded.nodes
  mailTypeMessage.value = loaded.message
  if (sheetRows.value.length) sheetRows.value = applyPctMailTypes(sheetRows.value, mailNodes.value)
}

watch(connected, (ok) => { if (ok) void loadMailTypes(false) }, { immediate: true })

async function onSheet(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    sheetRows.value = []
    sheetNotice.value = '请传入 xlsx 表格。'
    return
  }
  try {
    const parsed = pctRowsFromTable(await readXlsxRows(await file.arrayBuffer()))
    sheetRows.value = applyPctMailTypes(parsed.rows, mailNodes.value)
    sheetNotice.value = parsed.notice
  } catch (error) {
    sheetRows.value = []
    sheetNotice.value = error instanceof Error ? error.message : '表格没有读出来。'
  }
}

function seedQuery(volumes: string[], ctrl: string): void {
  seedToken.value += 1
  seed.value = {
    ...querySnapshot(draftFields.value),
    case_volume: joinCaseVolumes(volumes),
    ctrl_proc: ctrl
  }
}

async function querySheet(mode: 'batch' | 'each'): Promise<void> {
  const ctrl = selectedCtrl()
  if (!ctrl) {
    message.value = '处理事项要先从列表里选中，再查询。'
    return
  }
  const volumes = volumesOf(sheetRows.value)
  if (!volumes.length) {
    message.value = '先传入带我方文号的表格。'
    return
  }
  if (mode === 'batch') {
    seedQuery(volumes, ctrl)
    await search({ type: 'all', caseVolume: joinCaseVolumes(volumes), ctrlProcId: ctrl, fields: { case_volume: joinCaseVolumes(volumes), ctrl_proc: ctrl } })
    return
  }
  await queryEach(volumes, ctrl)
}

async function queryEach(volumes: string[], ctrl: string): Promise<void> {
  loading.value = true
  sheetMerged.value = true
  selected.value = []
  seedQuery([volumes[0] ?? ''], ctrl)
  const merged = new Map<string, LimitMonitorRow>()
  const missed: string[] = []
  try {
    for (let index = 0; index < volumes.length; index += 1) {
      const volume = volumes[index] ?? ''
      message.value = `正在逐个查询 ${index + 1}/${volumes.length}：${volume}`
      const fields = { case_volume: volume, ctrl_proc: ctrl }
      remember({ caseVolume: volume, ctrlProcId: ctrl, fields })
      const data = await requestPage({ type: 'all', caseVolume: volume, ctrlProcId: ctrl, fields, pageIndex: 1, pageSize: 100 })
      if (!data.items.length) missed.push(volume)
      for (const row of data.items) merged.set(row.procId, row)
    }
    rows.value = [...merged.values()]
    total.value = rows.value.length
    pageIndex.value = 1
    lastQuery.value = { type: 'all', caseVolume: volumes[0] ?? '', ctrlProcId: ctrl, fields: { case_volume: volumes[0] ?? '', ctrl_proc: ctrl } }
    message.value = missed.length
      ? `逐个查完，共 ${rows.value.length} 件。这几个文号没有记录：${missed.slice(0, 8).join('、')}`
      : `逐个查完，共 ${rows.value.length} 件。`
  } catch (error) {
    message.value = typeof error === 'string' ? error : '逐个查询中断了。'
  } finally {
    loading.value = false
  }
}

async function createTask(): Promise<void> {
  const customer = pctCustomer.value
  if (!customer) {
    message.value = '先在客户管理把查询入口选成期限监控，并选择 PCT提醒。'
    return
  }
  if (!sheetRows.value.length) {
    message.value = '先传入 PCT 表格。'
    return
  }
  sheetRows.value = applyPctMailTypes(sheetRows.value, mailNodes.value)
  if (sheetRows.value.some(row => !row.mailTypeId)) {
    message.value = '发文类型还没从原网站读全。连上 EASY 后点重新读取，再创建任务。'
    return
  }
  const ctrl = selectedCtrl()
  if (!ctrl) {
    message.value = '处理事项要先从列表里选中，再创建任务。'
    return
  }
  const scope = scopeFromConnection(connection.value)
  if (!scope) {
    message.value = '还没确认当前登录的人，任务没有创建。'
    return
  }
  const volumes = volumesOf(sheetRows.value)
  const caseVolume = joinCaseVolumes(volumes)
  const fields = querySnapshot({ ctrl_proc: ctrl, ...(caseVolume.length <= 4000 ? { case_volume: caseVolume } : {}) })
  const task: PctTaskDraft = {
    workflowId: 'pct-reminder',
    ctrlProcId: ctrl,
    rows: sheetRows.value,
    confirmedProcIds: confirmedIds.value.filter(item => isQueryGuid(item)),
    createdAt: new Date().toISOString()
  }
  if (!isPctTask(task)) {
    message.value = '这张表格组不成任务。'
    return
  }
  savingTask.value = true
  const next = applyBoundQuery(customer, {
    surface: 'limit',
    fields,
    templateId: templateId.value,
    reviewSelf: customer.reviewTarget === 'self'
  })
  next.pctTask = clonePctTask(task)
  const result = await call({
    action: 'saveCustomer',
    profile: { ...next, updatedAt: new Date().toISOString() },
    expectedScope: scope,
    expectedRevision: customer.revision ?? 1
  })
  savingTask.value = false
  if (!result?.ok) {
    message.value = result?.message || '任务没有保存。'
    return
  }
  submittedFields.value = fields
  const savedText = `已按表格创建任务。${summarizePctTask(task)}还不会向 EASY 提交发文。`
  seedQuery(volumes, ctrl)
  await search({ type: 'all', caseVolume, ctrlProcId: ctrl, fields: { case_volume: caseVolume, ctrl_proc: ctrl } })
  message.value = `${savedText}${message.value ? ` ${message.value}` : ''}`
}
</script>

<template>
  <LimitPage live hide-form selectable :selected="selected" :rows="rows" :total="sheetMerged ? rows.length : total" :loading="loading" :message="message" :connected="connected" :page-index="pageIndex" :page-size="shownPageSize" @page="goPage" @select="onSelect" @confirm="onConfirm">
    <section v-if="!connected" class="card"><p class="empty">尚未确认 EASY 用户，不能读取期限模板。</p></section>
    <template v-else>
      <section class="card">
        <div class="section-heading"><strong>PCT 提醒表格</strong></div>
        <p class="hint">客户管理里选择了 PCT提醒 之后，传入表格就能创建任务。我方文号可以逐个查，也可以用分号、空格或换行一起查。处理事项只能从下面的列表里选择后再查。发文类型从原网站热加载：有客户文号对「贵方案号」且深圳市的那一项，只有我方文号对「我方案号」且深圳市的那一项。</p>
        <p v-if="mailTypeMessage" class="hint">{{ mailTypeMessage }}</p>
        <template v-else>
          <p class="hint">有客户文号：{{ mailMatch.customerVolume?.name || '原网站这次没有返回这一项' }}</p>
          <p v-if="mailMatch.ourVolumeOtherCity" class="hint">{{ mailMatch.ourVolumeOtherCity.name }}</p>
          <p class="hint">只有我方文号：{{ mailMatch.ourVolumeShenzhen?.name || '原网站这次没有返回这一项' }}</p>
        </template>
        <button type="button" class="text-button" @click="loadMailTypes(true)">重新读取发文类型</button>
        <p v-if="pctCustomer" class="hint">当前客户：{{ pctCustomer.name }}<template v-if="pctCustomer.pctTask">。已有任务：{{ summarizePctTask(pctCustomer.pctTask) }}</template></p>
        <p v-else class="hint">还没有选择 PCT提醒 的客户。先到客户管理把查询入口选成期限监控，再选 PCT提醒。</p>
        <label>传入表格<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="loading || savingTask" @change="onSheet" /></label>
        <p v-if="sheetNotice" class="hint">{{ sheetNotice }}</p>
        <p v-if="sheetRows.length" class="hint">{{ sheetSummary }}</p>
        <div class="filters">
          <button class="solid" type="button" :disabled="loading || savingTask" @click="createTask">{{ savingTask ? '正在创建…' : '按表格创建任务' }}</button>
          <button class="ghost" type="button" :disabled="loading || savingTask" @click="querySheet('batch')">所有文号一起查询</button>
          <button class="ghost" type="button" :disabled="loading || savingTask" @click="querySheet('each')">逐个文号查询</button>
        </div>
      </section>
      <BindQueryBar surface="limit" show-load :fields="boundFields" :template-id="templateId" @load="loadBound" />
      <p v-if="confirmedIds.length" class="hint">已确认勾选 {{ confirmedIds.length }} 件。</p>
      <p v-else-if="selected.length" class="hint">已勾选 {{ selected.length }} 件。点结果表上的「确认勾选」才会记下来。创建发文的写开关仍然关着。</p>
      <LimitQuerySection :bridge="bridge" :user-id="connection.operatorId" :can-search="connected && !loading" :seed="seed" :seed-token="seedToken" @search="search" @draft="draftFields = $event" />
    </template>
  </LimitPage>
</template>
