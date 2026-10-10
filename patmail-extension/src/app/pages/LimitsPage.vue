<script setup lang="ts">
import { computed, inject, onActivated, onMounted, ref, watch } from 'vue'
import LimitPage from '../../shell/pages/LimitPage.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import BindQueryBar from '../components/BindQueryBar.vue'
import type { LimitMonitorResult, LimitMonitorRow } from '../../api/limit-monitor-types'
import { isLimitMonitorType, type LimitMonitorQuery } from '../../api/limit-monitor-params'
import { PCT_RESUME_KEY, PENDING_CUSTOMER_KEY, querySnapshot } from '../../customer/mail-flow'
import { clonePctTask, readWorkflowTask, writeWorkflowTask } from '../../customer/pct-sheet'
import { limitMailItems, limitMailLetterLabel, limitMailProcIds, limitMailSubmitShouldHalt, runLimitMailSubmit, runMailLetterPool } from '../../customer/limit-mail-submit'
import { inventorCustomerNames, recipientModeForTask } from '../../workflow/catalog'
import { joinCaseVolumes, splitCaseVolumes } from '../../customer/volume-list'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkflowCatalog } from '../composables/useWorkflowCatalog'
import { useWorkspace } from '../composables/useWorkspace'
import { beginProgress, classifySubmitText, endProgress, logProgress, progressSummaryLine, tallyProgress } from '../dialog'
import { useMailConcurrency } from '../../settings/use-mail-concurrency'
import { useWriteSwitch } from '../../settings/use-write-switch'

const { open: writesOpen, ready: writesReady } = useWriteSwitch()
const { concurrency } = useMailConcurrency()
const bridge = inject<MessageBridge>('bridge')
const { connection, customers, call } = useWorkspace()
const { catalog } = useWorkflowCatalog()
const pctDefinition = computed(() => catalog.value.workflows.find(item => item.id === 'pct-reminder') ?? null)
const connected = computed(() => connection.value.sessionStatus === 'authenticated')
const loading = ref(false)
const message = ref('')
const rows = ref<LimitMonitorRow[]>([])
const gates = ref<Record<string, 'open' | 'pending' | 'done'>>({})
const checkingGates = ref(false)
let gateToken = 0
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


async function requestPage(query: LimitMonitorQuery): Promise<LimitMonitorResult> {
  if (!bridge || !connected.value) throw '尚未连接 EASY。'
  const response = await bridge.request({ type: MessageType.SearchLimitMonitor, payload: { query } })
  if (response.type === MessageType.Error) throw response.payload.message
  if (response.type !== MessageType.SearchLimitMonitorResult) throw '期限查询返回了意外结果。'
  if (!response.payload.ok) throw textFor(response.payload.error.code, response.payload.error.message)
  return response.payload.data
}

async function markSendGates(items: LimitMonitorRow[]): Promise<void> {
  const token = ++gateToken
  if (!bridge || !items.length) {
    gates.value = {}
    checkingGates.value = false
    return
  }
  const current = bridge
  checkingGates.value = true
  const jobs = new Map<string, { caseId: string; procId: string }>()
  for (const row of items) {
    if (isQueryGuid(row.caseId) && isQueryGuid(row.procId)) jobs.set(`${row.caseId}|${row.procId}`, { caseId: row.caseId, procId: row.procId })
  }
  const resolved = new Map<string, 'open' | 'pending' | 'done'>()
  const queue = [...jobs.values()]
  let failed = 0
  async function worker(): Promise<void> {
    while (queue.length && token === gateToken) {
      const job = queue.shift()
      if (!job) return
      const response = await current.request({ type: MessageType.ReadCaseBusFlow, payload: { caseId: job.caseId, procId: job.procId } })
      if (token !== gateToken) return
      if (response.type === MessageType.CaseBusFlowResult && response.payload.ok) {
        resolved.set(`${job.caseId}|${job.procId}`, response.payload.data.gate)
      } else {
        failed += 1
        resolved.set(`${job.caseId}|${job.procId}`, 'pending')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, Math.max(queue.length, 1)) }, () => worker()))
  if (token !== gateToken) return
  const next: Record<string, 'open' | 'pending' | 'done'> = {}
  let unchecked = 0
  for (const row of items) {
    if (!isQueryGuid(row.caseId) || !isQueryGuid(row.procId)) {
      unchecked += 1
      continue
    }
    const gate = resolved.get(`${row.caseId}|${row.procId}`)
    if (gate) next[row.procId] = gate
    else unchecked += 1
  }
  gates.value = next
  checkingGates.value = false
  selected.value = selected.value.filter(id => next[id] === 'open' || next[id] === 'done')
  const pending = items.filter(row => next[row.procId] === 'pending').length
  const bits = [
    pending ? `待审核 ${pending} 个，已标灰，不能勾选。` : '',
    failed ? `${failed} 件没有读到发文流程，先按待审核处理。` : '',
    unchecked ? `${unchecked} 件没有核对到发文流程，不按还没提交审核计算。` : ''
  ].filter(Boolean)
  if (bits.length) message.value = [message.value, ...bits].filter(Boolean).join('')
}

async function search(input: { type: string; caseVolume?: string; applicationNo?: string; customerName?: string; ctrlProcId?: string; fields?: Record<string, string>; templateId?: string; reset?: boolean; page?: number }): Promise<void> {
  if (input.reset) {
    rows.value = []
    gates.value = {}
    checkingGates.value = false
    gateToken += 1
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
    gates.value = {}
    checkingGates.value = data.items.length > 0
    total.value = data.total
    pageIndex.value = targetPage
    message.value = data.items.length ? '' : '这个条件下没有期限记录。'
    void markSendGates(data.items)
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
    gates.value = {}
    checkingGates.value = items.length > 0
    total.value = items.length
    pageIndex.value = 1
    message.value = items.length ? `一起查完，共 ${items.length} 件。` : '这个条件下没有期限记录。'
    void markSendGates(items)
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

async function onSubmitAsk(): Promise<void> {
  if (!writesReady.value) {
    message.value = '正在读取系统设置里的写开关。'
    return
  }
  if (!writesOpen.value) {
    message.value = '写开关在系统设置里关着，没有提交到 EASY。'
    return
  }
  if (!bridge || !connected.value) {
    message.value = '尚未连接 EASY。'
    return
  }
  const task = readWorkflowTask()
  const flow = catalog.value.workflows.find(item => item.id === task?.workflowId) ?? pctDefinition.value
  const planned = limitMailItems({
    procIds: confirmedIds.value.length ? confirmedIds.value : (task?.confirmedProcIds ?? []),
    rows: rows.value,
    sheetRows: task?.rows ?? [],
    mode: recipientModeForTask(task, catalog.value.workflows),
    specials: inventorCustomerNames(flow)
  })
  if (!planned.ok) {
    message.value = planned.message
    return
  }
  const sent = new Set<string>()
  const width = concurrency.value
  beginProgress('提交到 EASY', planned.items.length)
  let finished = 0
  try {
    const { halted, unstarted } = await runMailLetterPool(planned.items, width, async (item) => {
      const label = limitMailLetterLabel(item, id => rows.value.find(entry => entry.procId === id)?.caseVolume ?? '')
      logProgress(`正在处理 ${label}。`)
      const text = await runLimitMailSubmit(bridge, connection.value.operatorId, [item], gates.value)
      const kind = classifySubmitText(text)
      tallyProgress(kind, limitMailProcIds(item).length)
      finished += 1
      text.split('\n').forEach((line, lineIndex) => logProgress(lineIndex === 0 ? `${label}：${line}` : line, finished))
      if (text.startsWith('已提交')) {
        for (const id of limitMailProcIds(item)) sent.add(id.toLowerCase())
      }
      return limitMailSubmitShouldHalt(text)
    })
    if (sent.size) confirmedIds.value = confirmedIds.value.filter(id => !sent.has(id.toLowerCase()))
    if (halted) tallyProgress('skipped', unstarted.reduce((sum, item) => sum + limitMailProcIds(item).length, 0))
    logProgress(progressSummaryLine(), finished)
    message.value = progressSummaryLine()
  } catch (error: unknown) {
    logProgress(error instanceof Error ? error.message : '提交中断了。')
    logProgress(progressSummaryLine())
    message.value = '提交中断了。进度框里有已经完成的统计。'
  } finally {
    endProgress()
  }
}

async function onConfirm(ids: string[]): Promise<void> {
  const open = new Set(rows.value.filter(row => {
    const gate = gates.value[row.procId]
    return gate === 'open' || gate === 'done'
  }).map(row => row.procId))
  const procIds = ids.filter(item => isQueryGuid(item) && open.has(item))
  if (!procIds.length && ids.length) {
    message.value = checkingGates.value ? '还在核对发文审核状态，先不能确认。' : '已提交审核的不能勾选。'
    return
  }
  confirmedIds.value = procIds
  const stored = readWorkflowTask()
  if (stored) {
    const next = clonePctTask({ ...stored, confirmedProcIds: procIds })
    writeWorkflowTask(next)
    message.value = `已确认勾选 ${procIds.length} 件，写进这次工作流任务。任务记在插件里，还不会提交到 EASY。`
    return
  }
  const customer = pctCustomer.value
  if (!customer?.pctTask) {
    message.value = `已确认勾选 ${procIds.length} 件。创建任务时会带上这些处理事项。任务记在插件里，还不会提交到 EASY。`
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
    ? `已确认勾选 ${procIds.length} 件，并写进${customer.name}的 PCT 任务。任务记在插件里，还不会提交到 EASY。`
    : (result?.message || `已确认勾选 ${procIds.length} 件，但没有写进任务。`)
}


function seedQuery(volumes: string[], ctrl: string): void {
  seedToken.value += 1
  seed.value = {
    ...querySnapshot(draftFields.value),
    case_volume: joinCaseVolumes(volumes),
    ctrl_proc: ctrl
  }
}

async function resumeQuery(): Promise<void> {
  const raw = sessionStorage.getItem(PCT_RESUME_KEY)
  if (!raw) return
  sessionStorage.removeItem(PCT_RESUME_KEY)
  let parsed: { caseVolume?: string; ctrlProcId?: string }
  try {
    parsed = JSON.parse(raw) as { caseVolume?: string; ctrlProcId?: string }
  } catch {
    return
  }
  const caseVolume = parsed.caseVolume?.trim() ?? ''
  const ctrl = parsed.ctrlProcId?.trim() ?? ''
  if (!caseVolume || !isQueryGuid(ctrl)) return
  if (!connected.value) {
    message.value = '任务已经记下。连上 EASY 之后，可以用我方文号再查一次。'
    return
  }
  seedQuery(splitCaseVolumes(caseVolume), ctrl)
  await search({ type: 'all', caseVolume, ctrlProcId: ctrl, fields: { case_volume: caseVolume, ctrl_proc: ctrl } })
}

watch(() => connection.value.easyOrigin, (next, previous) => {
  if (!previous || next === previous) return
  gateToken += 1
  rows.value = []
  gates.value = {}
  checkingGates.value = false
  selected.value = []
  confirmedIds.value = []
  message.value = ''
  total.value = 0
  loading.value = false
  sheetMerged.value = false
  submittedFields.value = {}
  draftFields.value = {}
  seed.value = null
  seedToken.value += 1
})

onMounted(() => { void resumeQuery() })
onActivated(() => { void resumeQuery() })

</script>

<template>
  <LimitPage live hide-form selectable :writes-open="writesOpen" :writes-ready="writesReady" :selected="selected" :rows="rows" :gates="gates" :checking="checkingGates" :total="sheetMerged ? rows.length : total" :loading="loading" :message="message" :connected="connected" :page-index="pageIndex" :page-size="shownPageSize" @page="goPage" @select="onSelect" @confirm="onConfirm" @submit="onSubmitAsk">
    <section v-if="!connected" class="card"><p class="empty">尚未确认 EASY 用户，不能读取期限模板。</p></section>
    <template v-else>
      <LimitQuerySection :bridge="bridge" :user-id="connection.operatorId" :can-search="connected && !loading" :seed="seed" :seed-token="seedToken" @search="search" @draft="draftFields = $event" />
      <BindQueryBar surface="limit" show-load :fields="boundFields" :template-id="templateId" @load="loadBound" />
      <p v-if="confirmedIds.length" class="hint">已确认勾选 {{ confirmedIds.length }} 件。</p>
      <p v-else-if="selected.length" class="hint">已勾选 {{ selected.length }} 件。点结果表上的「确认勾选」才会记下来。记在插件里的任务不会因此提交到 EASY。</p>
    </template>
  </LimitPage>
</template>
