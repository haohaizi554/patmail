<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import LimitPage from '../../shell/pages/LimitPage.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import type { LimitMonitorResult, LimitMonitorRow } from '../../api/limit-monitor-types'
import { isLimitMonitorType, type LimitMonitorQuery } from '../../api/limit-monitor-params'
import { MAILED_UNFINISHED_REVIEW, SKIP_SEND_REVIEW } from '../../customer/pct-flow-status'
import { clonePctTask, readWorkflowTask, writeWorkflowTask } from '../../customer/pct-sheet'
import { limitMailItems, limitMailLetterLabel, limitMailProcIds, limitMailSubmitShouldHalt, runLimitMailSubmit, runMailLetterPool, selectionNeedsAddressChoice } from '../../customer/limit-mail-submit'
import { beginProgress, classifySubmitText, confirmDialog, endProgress, logProgress, noteProgress, progressSummaryLine, tallyProgress } from '../dialog'
import { splitCaseVolumes } from '../../customer/volume-list'
import { isQueryGuid } from '../../query/query-validator'
import { flushRecovery, holdRecovery, peekRecovery, recallRecovery, scheduleRecovery, systemScope } from '../../recovery/wal-ledger'
import { readLimitTimeout } from '../../api/query-timeout'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useMailConcurrency } from '../../settings/use-mail-concurrency'
import { useWorkspace } from '../composables/useWorkspace'
import { isWriteSwitchOpen, isWriteSwitchReady } from '../../settings/write-switch'
import { useWriteSwitch } from '../../settings/use-write-switch'

const props = defineProps<{
  bridge?: MessageBridge
  userId: string
  connected: boolean
  seed?: Record<string, string> | null
  procQueries?: Array<{ id: string; volumes: string }>
  seedToken?: number
  caseVolume?: string
  sheetRows?: Array<{ ourVolume: string; procLabel?: string; mailTypeId?: string; customerName?: string; contactName?: string; iprName?: string; leadName?: string; mailTo?: string; mailCc?: string; iprCarried?: true; contactCarried?: true; leadCarried?: true; iprArbitrated?: true }>
  recipientMode?: 'ipr' | 'lead'
  inventorCustomers?: string[]
  flowByKey?: Record<string, string>
  /** 下面的核对已经在读同一批流程。上表不再为这 40 行另开一轮流程图。 */
  flowChecking?: boolean
  /** 「已发文，事项未管制完成日」的行是否允许勾选提交。默认允许，提交前会弹警示框。 */
  allowMailedUnfinished?: boolean
}>()

const { open: writesOpen, ready: writesReady } = useWriteSwitch()
const { concurrency } = useMailConcurrency()

const emit = defineEmits<{
  confirm: [procIds: string[]]
  result: [payload: { items: LimitMonitorRow[]; gates: Record<string, 'open' | 'pending' | 'done'>; checking: boolean; message: string }]
  refreshStatus: [payload: { targets: Array<{ caseVolume: string; procLabel: string }>; abnormal: Array<{ caseVolume: string; procLabel: string }> }]
}>()

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
const closedIds = ref(new Set<string>())
const hasIprGap = computed(() => selectionNeedsAddressChoice(
  rows.value,
  props.sheetRows ?? [],
  selected.value,
  rows.value.filter(row => rowCanConfirm(row.procId)).map(row => row.procId)
))
const sheetMerged = ref(false)
const lastQuery = ref<Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> | null>(null)
const templateId = ref('')
const mergedPageSize = 100
const pagedRows = computed(() => {
  if (!sheetMerged.value) return rows.value
  const start = (pageIndex.value - 1) * mergedPageSize
  return rows.value.slice(start, start + mergedPageSize)
})

function sheetVolumeKey(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

const plainProcIds = computed(() => {
  const marked = new Set<string>()
  for (const row of props.sheetRows ?? []) {
    if (!row.iprArbitrated && !row.iprCarried && !row.contactCarried && !row.leadCarried) continue
    marked.add(`${sheetVolumeKey(row.ourVolume)}\n${(row.procLabel ?? '').trim()}`)
  }
  const ids: string[] = []
  for (const row of rows.value) {
    const key = `${sheetVolumeKey(row.caseVolume)}\n${row.ctrlProc.trim()}`
    if (!marked.has(key) && isQueryGuid(row.procId)) ids.push(row.procId)
  }
  return ids
})

const flowByProc = computed(() => {
  const source = props.flowByKey ?? {}
  const out: Record<string, string> = {}
  for (const row of rows.value) {
    const text = source[`${sheetVolumeKey(row.caseVolume)}\n${row.ctrlProc.trim()}`]
    if (text) out[row.procId] = text
  }
  return out
})

type SearchInput = Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> & { reset?: boolean; templateId?: string; page?: number }

function readQueryDesk(): unknown | null {
  if (!rows.value.length && !selected.value.length && !confirmedIds.value.length) return null
  const owner = props.userId
  return {
    version: 1,
    operatorId: isQueryGuid(owner) ? owner.toLowerCase() : '',
    rows: rows.value,
    gates: { ...gates.value },
    selected: selected.value,
    confirmedIds: confirmedIds.value,
    message: message.value,
    total: total.value,
    pageIndex: pageIndex.value,
    pageSize: pageSize.value,
    sheetMerged: sheetMerged.value,
    lastQuery: lastQuery.value
  }
}

function applyQueryDesk(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || rows.value.length) return
  const desk = payload as Record<string, unknown>
  if (desk.version !== 1 || !Array.isArray(desk.rows) || !desk.rows.length) return
  const owner = typeof desk.operatorId === 'string' ? desk.operatorId.toLowerCase() : ''
  if (isQueryGuid(props.userId) && owner && props.userId.toLowerCase() !== owner) return
  rows.value = desk.rows as LimitMonitorRow[]
  gates.value = desk.gates && typeof desk.gates === 'object' ? desk.gates as Record<string, 'open' | 'pending' | 'done'> : {}
  selected.value = Array.isArray(desk.selected) ? desk.selected.filter((item): item is string => typeof item === 'string') : []
  confirmedIds.value = Array.isArray(desk.confirmedIds) ? desk.confirmedIds.filter((item): item is string => typeof item === 'string') : []
  if (typeof desk.message === 'string' && desk.message) message.value = desk.message
  if (typeof desk.total === 'number') total.value = desk.total
  if (typeof desk.pageIndex === 'number' && desk.pageIndex > 0) pageIndex.value = desk.pageIndex
  sheetMerged.value = desk.sheetMerged === true
  lastQuery.value = desk.lastQuery && typeof desk.lastQuery === 'object' ? desk.lastQuery as Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> : null
  if (!message.value) message.value = '登录中断前的查询结果已经从本机恢复账本找回。'
  publish()
}

const { connection } = useWorkspace()
let queryScope = systemScope(connection.value.easyOrigin, 'workflow')
let parkingQuery = false

function pokeQuery(): void {
  if (parkingQuery) return
  scheduleRecovery('limit-query', queryScope, readQueryDesk)
}

watch(() => connection.value.easyOrigin, (next, previous) => {
  if (next === previous) return
  if (!previous) {
    queryScope = systemScope(next, 'workflow')
    if (rows.value.length) return
    const arriving = queryScope
    void recallRecovery('limit-query', arriving).then(async saved => {
      if (!saved) saved = await recallRecovery('limit-query', 'workflow')
      if (queryScope !== arriving || rows.value.length) return
      applyQueryDesk(saved)
      pokeQuery()
    }).catch(() => { /* 这个系统还没有账本 */ })
    return
  }
  parkingQuery = true
  const payload = readQueryDesk()
  holdRecovery('limit-query', systemScope(previous, 'workflow'), payload)
  clearProcQuery()
  queryScope = systemScope(next, 'workflow')
  const cached = peekRecovery('limit-query', queryScope)
  const arriving = queryScope
  if (cached) applyQueryDesk(cached)
  parkingQuery = false
  pokeQuery()
  if (cached === undefined) {
    void recallRecovery('limit-query', arriving).then(saved => {
      if (queryScope !== arriving || rows.value.length) return
      applyQueryDesk(saved)
      pokeQuery()
    }).catch(() => { /* 这个系统还没有账本 */ })
  }
})

watch([rows, selected, confirmedIds, message, pageIndex], pokeQuery, { deep: true })

onMounted(() => {
  queryScope = systemScope(connection.value.easyOrigin, 'workflow')
  if (queryScope.endsWith('|local')) return
  void recallRecovery('limit-query', queryScope).then(payload => payload ?? recallRecovery('limit-query', 'workflow')).then(payload => {
    applyQueryDesk(payload)
  }).catch(() => { /* 没有账本就等下一次查询 */ })
})
onUnmounted(() => { void flushRecovery('limit-query', queryScope, readQueryDesk) })

function publish(): void {
  emit('result', {
    items: rows.value.slice(),
    gates: { ...gates.value },
    checking: loading.value || checkingGates.value,
    message: message.value
  })
}

function textFor(code: string, fallback: string, timeoutMs = 60_000): string {
  if (code === 'REQUEST_TIMEOUT') return `原网站查询太慢，没有在 ${timeoutMs / 60_000} 分钟内返回。可以把超时时间调长后再查。`
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'HTTP_ERROR') return 'EASY 暂时没有返回列表，可以再查一次。'
  if (code === 'INVALID_QUERY') return fallback || '请输入查询条件。'
  return fallback || '期限查询失败，请稍后重试。'
}

async function requestPage(query: LimitMonitorQuery): Promise<LimitMonitorResult> {
  if (!props.bridge || !props.connected) throw '尚未连接 EASY。'
  const timeoutMs = await readLimitTimeout()
  const response = await props.bridge.request({ type: MessageType.SearchLimitMonitor, payload: { query, timeoutMs } })
  if (response.type === MessageType.Error) throw response.payload.message
  if (response.type !== MessageType.SearchLimitMonitorResult) throw '期限查询返回了意外结果。'
  if (!response.payload.ok) throw textFor(response.payload.error.code, response.payload.error.message, timeoutMs)
  return response.payload.data
}

async function markSendGates(items: LimitMonitorRow[], merge = false): Promise<void> {
  const token = ++gateToken
  if (!props.bridge || !items.length) {
    if (!merge) {
      gates.value = {}
      checkingGates.value = false
    }
    return
  }
  const current = props.bridge
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
  gates.value = merge ? { ...gates.value, ...next } : next
  checkingGates.value = false
  if (merge) {
    publish()
    return
  }
  selected.value = selected.value.filter(id => {
    const gate = next[id]
    return !gate || gate === 'open' || gate === 'done'
  })
  const pending = items.filter(row => next[row.procId] === 'pending').length
  const bits = [
    pending ? `待审核 ${pending} 个，已标灰，不能勾选。` : '',
    failed ? `${failed} 件没有读到发文流程，没有当成已提交审核。勾选还在，可以再点「提交到 EASY」。` : '',
    unchecked ? `${unchecked} 件没有核对到发文流程，不按还没提交审核计算。` : ''
  ].filter(Boolean)
  if (bits.length) message.value = [message.value, ...bits].filter(Boolean).join('')
  publish()
}

async function showCollected(query: Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'>): Promise<void> {
  loading.value = true
  sheetMerged.value = true
  selected.value = []
  message.value = '正在按这些文号一起查询…'
  publish()
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
    publish()
    void markSendGates(items)
  } catch (error) {
    message.value = typeof error === 'string' ? error : '期限查询失败，请重试。'
  } finally {
    loading.value = false
    publish()
  }
}

async function queryEach(volumes: string[], ctrl: string): Promise<void> {
  loading.value = true
  sheetMerged.value = true
  selected.value = []
  const merged = new Map<string, LimitMonitorRow>()
  const missed: string[] = []
  try {
    for (let index = 0; index < volumes.length; index += 1) {
      const volume = volumes[index] ?? ''
      message.value = `正在逐个查询 ${index + 1}/${volumes.length}：${volume}`
      const fields = { case_volume: volume, ctrl_proc: ctrl }
      const data = await requestPage({ type: 'all', caseVolume: volume, ctrlProcId: ctrl, fields, pageIndex: 1, pageSize: 100 })
      if (!data.items.length) missed.push(volume)
      for (const row of data.items) merged.set(row.procId, row)
      rows.value = [...merged.values()]
      total.value = rows.value.length
      publish()
    }
    rows.value = [...merged.values()]
    gates.value = {}
    checkingGates.value = rows.value.length > 0
    total.value = rows.value.length
    pageIndex.value = 1
    lastQuery.value = { type: 'all', caseVolume: volumes[0] ?? '', ctrlProcId: ctrl, fields: { case_volume: volumes[0] ?? '', ctrl_proc: ctrl } }
    message.value = missed.length
      ? `逐个查完，共 ${rows.value.length} 件。这几个文号没有记录：${missed.slice(0, 8).join('、')}`
      : `逐个查完，共 ${rows.value.length} 件。`
    publish()
    void markSendGates(rows.value)
  } catch (error) {
    message.value = typeof error === 'string' ? error : '逐个查询中断了。'
  } finally {
    loading.value = false
    publish()
  }
}

async function search(input: SearchInput): Promise<void> {
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
    sheetMerged.value = false
    publish()
    return
  }
  if (!props.bridge || !props.connected) {
    message.value = '尚未连接 EASY。'
    publish()
    return
  }
  if (!isLimitMonitorType(input.type)) {
    message.value = '这个页签还不能查询。'
    publish()
    return
  }
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
  if (!input.page) {
    confirmedIds.value = []
    emit('confirm', [])
  }
  if (!input.page && splitCaseVolumes(query.caseVolume ?? '').length > 1) {
    await showCollected(query)
    const volumes = splitCaseVolumes(query.caseVolume ?? '')
    if (!rows.value.length && volumes.length > 1 && query.ctrlProcId && !message.value.includes('登录')) await queryEach(volumes, query.ctrlProcId)
    return
  }
  if (!input.page) {
    selected.value = []
    sheetMerged.value = false
  }
  loading.value = true
  message.value = ''
  publish()
  const targetPage = input.page ?? 1
  try {
    const data = await requestPage({ ...query, pageIndex: targetPage, pageSize: pageSize.value })
    rows.value = data.items
    gates.value = {}
    checkingGates.value = data.items.length > 0
    total.value = data.total
    pageIndex.value = targetPage
    message.value = data.items.length ? '' : '这个条件下没有期限记录。'
    publish()
    void markSendGates(data.items)
  } catch (error) {
    message.value = typeof error === 'string' ? error : '期限查询失败，请重试。'
  } finally {
    loading.value = false
    publish()
  }
}

function goPage(page: number): void {
  if (sheetMerged.value) {
    const pages = Math.max(1, Math.ceil(rows.value.length / mergedPageSize))
    if (page < 1 || page > pages) return
    pageIndex.value = page
    return
  }
  if (!lastQuery.value || loading.value) return
  void search({ ...lastQuery.value, page })
}

function rowCanConfirm(procId: string): boolean {
  if (closedIds.value.has(procId.toLowerCase())) return false
  const flow = flowByProc.value[procId]
  if (flow === MAILED_UNFINISHED_REVIEW) return props.allowMailedUnfinished !== false
  if (flow === '已提交审核' || flow === SKIP_SEND_REVIEW) return false
  const gate = gates.value[procId]
  if (gate === 'pending') return false
  return true
}

function blockMessage(ids: string[], verb: '提交' | '勾选'): string {
  if (checkingGates.value) {
    return verb === '提交' ? '还在核对发文审核状态，先不能提交。' : '还在核对发文审核状态，先不能确认。'
  }
  const reasons = ids.filter(id => isQueryGuid(id) && !rowCanConfirm(id)).map(id => {
    if (closedIds.value.has(id.toLowerCase())) return 'closed'
    const flow = flowByProc.value[id]
    if (flow === MAILED_UNFINISHED_REVIEW && props.allowMailedUnfinished === false) return 'mailed'
    if (flow === SKIP_SEND_REVIEW) return 'skip'
    return 'review'
  })
  if (reasons.length && reasons.every(item => item === 'mailed')) {
    return verb === '提交'
      ? '已发文、事项还没写完成日的不能提交。上面的「已发文未管制的行允许发文」同时管勾选和提交，勾上之后再点提交，会先弹出警示框。'
      : '已发文、事项还没写完成日的不能勾选。先勾上上面的「已发文未管制的行允许发文」，这个开关同时管勾选和提交。'
  }
  if (reasons.length && reasons.every(item => item === 'skip')) {
    return verb === '提交' ? '不用发的不能提交。' : '不用发的不能勾选。'
  }
  if (reasons.length && reasons.every(item => item === 'closed')) return '这几件这次已经提交过，没有再提交。'
  return verb === '提交' ? '已提交审核的不能提交。' : '已提交审核的不能勾选。'
}

watch(() => props.allowMailedUnfinished, allow => {
  if (allow !== false) return
  const next = selected.value.filter(id => flowByProc.value[id] !== MAILED_UNFINISHED_REVIEW)
  if (next.length !== selected.value.length) selected.value = next
})

function onConfirm(ids: string[]): void {
  const procIds = ids.filter(item => isQueryGuid(item) && rowCanConfirm(item))
  if (!procIds.length && ids.length) {
    message.value = blockMessage(ids, '勾选')
    return
  }
  confirmedIds.value = procIds
  const stored = readWorkflowTask()
  if (stored) writeWorkflowTask(clonePctTask({ ...stored, confirmedProcIds: procIds }))
  message.value = `已确认勾选 ${procIds.length} 件。再点「提交到 EASY」会创建发文并交给当前登录人。`
  emit('confirm', procIds)
}

async function onSubmitAsk(address?: string): Promise<void> {
  if (!isWriteSwitchReady()) {
    message.value = '正在读取系统设置里的写开关。'
    return
  }
  if (!isWriteSwitchOpen()) {
    message.value = '写开关在系统设置里关着，没有提交到 EASY。'
    return
  }
  if (!props.bridge || !props.connected) {
    message.value = '尚未连接 EASY。'
    return
  }
  const bridge = props.bridge
  const task = readWorkflowTask()
  if (!selected.value.length) {
    message.value = '先勾选要提交的事项。'
    return
  }
  const live = selected.value.filter(item => isQueryGuid(item) && rowCanConfirm(item))
  if (!live.length) {
    message.value = blockMessage(selected.value, '提交')
    return
  }
  const procIds = live
  const mailedPending = rows.value.filter(row => procIds.includes(row.procId) && flowByProc.value[row.procId] === MAILED_UNFINISHED_REVIEW)
  if (mailedPending.length) {
    const lines = mailedPending.map(row => `${row.caseVolume}｜${row.ctrlProc}｜${row.customerName}`).join('\n')
    const goOn = await confirmDialog({
      title: `警示：${mailedPending.length} 行已发文、事项未管制完成日`,
      message: `这些行的发文流程已结束，但事项还没有管制完成日。\n这个状态分不出两种情况：真的发出过邮件，或没发文就把流程手动结束。请逐行确认到底发没发过，再提交会发一封新的：\n${lines}`,
      confirmLabel: '核对过，继续提交',
      cancelLabel: '再核对',
      warn: true
    })
    if (!goOn) {
      message.value = '没有提交。已发文、事项未管制完成日的行要先核对。'
      return
    }
  }
  confirmedIds.value = procIds
  if (task) writeWorkflowTask(clonePctTask({ ...task, confirmedProcIds: procIds }))
  emit('confirm', procIds)
  const planned = limitMailItems({
    procIds,
    rows: rows.value,
    sheetRows: props.sheetRows?.length ? props.sheetRows : (task?.rows ?? []),
    mode: props.recipientMode ?? (task?.recipientMode === 'lead' || task?.recipientMode === 'ipr' ? task.recipientMode : 'ipr'),
    specials: new Set(props.inventorCustomers ?? []),
    address: address === 'auto' ? 'auto' : address === 'all' ? 'all' : address === 'checked' ? 'checked' : 'named'
  })
  if (!planned.ok) {
    message.value = planned.message
    return
  }
  message.value = '正在创建发文并提交给当前登录人。'
  const involved = rows.value.filter(row => planned.items.some(item => limitMailProcIds(item).includes(row.procId)))
  beginProgress('提交到 EASY', planned.items.length + 1)
  const abnormal: Array<{ caseVolume: string; procLabel: string }> = []
  const sent = new Set<string>()
  const width = concurrency.value
  let handedOff = false
  try {
    if (width > 1 && involved.length) await markSendGates(involved, true)
    let finished = 0
    const { halted, unstarted } = await runMailLetterPool(planned.items, width, async (item) => {
      const letterRows = involved.filter(entry => limitMailProcIds(item).includes(entry.procId))
      const label = limitMailLetterLabel(item, id => letterRows.find(entry => entry.procId === id)?.caseVolume ?? '')
      logProgress(`正在核对 ${label} 的发文流程。`)
      if (width <= 1 && letterRows.length) await markSendGates(letterRows, true)
      logProgress(`正在处理 ${label}。`)
      const text = await runLimitMailSubmit(bridge, props.userId, [item], gates.value)
      const kind = classifySubmitText(text)
      tallyProgress(kind, limitMailProcIds(item).length)
      if (kind !== 'success') noteProgress(kind, label, text)
      if (kind === 'abnormal') {
        for (const row of letterRows) abnormal.push({ caseVolume: row.caseVolume, procLabel: row.ctrlProc })
      }
      finished += 1
      text.split('\n').forEach((line, lineIndex) => logProgress(lineIndex === 0 ? `${label}：${line}` : line, finished))
      if (kind === 'success') {
        for (const id of limitMailProcIds(item)) sent.add(id.toLowerCase())
      }
      return limitMailSubmitShouldHalt(text)
    })
    if (sent.size) {
      const keep = (id: string) => !sent.has(id.toLowerCase())
      confirmedIds.value = confirmedIds.value.filter(keep)
      selected.value = selected.value.filter(keep)
      const nextClosed = new Set(closedIds.value)
      for (const id of sent) nextClosed.add(id)
      closedIds.value = nextClosed
    }
    if (halted) {
      for (const item of unstarted) {
        const skipLabel = limitMailLetterLabel(item, id => rows.value.find(entry => entry.procId === id)?.caseVolume ?? '')
        const reason = '上一封结果无法确认，这一件没有开始。'
        tallyProgress('skipped', limitMailProcIds(item).length)
        noteProgress('skipped', skipLabel, reason)
        logProgress(`${skipLabel}：跳过。${reason}`)
      }
    }
    emit('confirm', confirmedIds.value)
    logProgress('正在回传所涉及案件的审核状态。', planned.items.length)
    await markSendGates(involved, true)
    emit('refreshStatus', {
      targets: involved.map(row => ({ caseVolume: row.caseVolume, procLabel: row.ctrlProc })),
      abnormal
    })
    handedOff = true
    message.value = ''
    publish()
  } catch (error: unknown) {
    logProgress(error instanceof Error ? error.message : '提交中断了。')
    message.value = '提交中断了。进度框里有已经完成的统计。'
  } finally {
    if (!handedOff) {
      logProgress(progressSummaryLine())
      endProgress()
    }
  }
}

function volumeChunks(text: string): string[] {
  const volumes = splitCaseVolumes(text)
  const chunks: string[] = []
  let current: string[] = []
  let length = 0
  for (const volume of volumes) {
    const next = length + volume.length + (current.length ? 1 : 0)
    if (current.length >= 40 || (current.length && next > 1800)) {
      chunks.push(current.join(';'))
      current = [volume]
      length = volume.length
    } else {
      current.push(volume)
      length = next
    }
  }
  if (current.length) chunks.push(current.join(';'))
  return chunks
}

let procSearchToken = 0

async function searchProcGroups(groups: Array<{ id: string; volumes: string }>): Promise<void> {
  const token = ++procSearchToken
  loading.value = true
  sheetMerged.value = true
  selected.value = []
  confirmedIds.value = []
  emit('confirm', [])
  rows.value = []
  gates.value = {}
  total.value = 0
  pageIndex.value = 1
  const merged = new Map<string, LimitMonitorRow>()
  let failed = 0
  let clipped = 0
  let lastError = ''
  publish()
  try {
    const procIds = [...new Set(groups.map(group => group.id))]
    const lists = volumeChunks(groups.flatMap(group => splitCaseVolumes(group.volumes)).join(';'))
    for (let chunkIndex = 0; chunkIndex < lists.length; chunkIndex += 1) {
      if (token !== procSearchToken) return
      const volume = lists[chunkIndex] ?? ''
      const sheetCount = props.sheetRows?.length ?? 0
      message.value = `正在查 ${procIds.length} 种处理事项，文号第 ${chunkIndex + 1}/${lists.length} 段。已经对上 ${rows.value.length} 件${sheetCount ? `，表格一共 ${sheetCount} 行` : ''}。`
      publish()
      const fields: Record<string, string> = { ctrl_proc: procIds.join(','), case_volume: volume }
      const query = { type: 'all' as const, caseVolume: volume, ctrlProcId: procIds.join(','), fields, pageIndex: 1, pageSize: 100 }
        let items: LimitMonitorRow[] | null = null
        for (let attempt = 0; attempt < 2 && !items; attempt += 1) {
          try {
            const first = await requestPage(query)
            const pageItems = [...first.items]
            const wanted = Math.max(1, Math.ceil(first.total / 100))
            const pages = Math.min(8, wanted)
            if (wanted > pages) clipped += 1
            for (let page = 2; page <= pages; page += 1) {
              if (token !== procSearchToken) return
              const next = await requestPage({ ...query, pageIndex: page })
              pageItems.push(...next.items)
            }
            items = pageItems
          } catch (error) {
            const text = typeof error === 'string' ? error : '期限查询失败，请重试。'
            if (/登录/.test(text)) throw text
            lastError = text
            if (attempt === 1) {
              failed += 1
              items = []
            }
          }
        }
      if (token !== procSearchToken) return
      const fresh: LimitMonitorRow[] = []
      for (const row of items ?? []) {
        if (merged.has(row.procId)) continue
        merged.set(row.procId, row)
        fresh.push(row)
      }
      if (fresh.length) rows.value.push(...fresh)
      total.value = rows.value.length
      publish()
    }
    if (token !== procSearchToken) return
    checkingGates.value = false
    lastQuery.value = null
    const sheetCount = props.sheetRows?.length ?? 0
    const missedNote = failed ? `${failed} 段没查成。` : ''
    const clipNote = clipped ? `${clipped} 段只取了前 800 件。` : ''
    message.value = rows.value.length
      ? (sheetCount
          ? `上面 ${rows.value.length} 件是这些文号在期限监控里还没办完的处理事项，没有按官方期限筛。下面表格一共 ${sheetCount} 行。${missedNote}${clipNote}`
          : `期限里还没结束的一共 ${rows.value.length} 件。${missedNote}${clipNote}`)
      : (lastError || '这个条件下没有期限记录。')
    publish()
    if (!props.flowChecking && rows.value.length && rows.value.length <= 80) void markSendGates(rows.value)
  } catch (error) {
    if (token !== procSearchToken) return
    message.value = typeof error === 'string' ? error : '期限查询失败，请重试。'
  } finally {
    if (token === procSearchToken) {
      loading.value = false
      publish()
    }
  }
}

function clearProcQuery(): void {
  procSearchToken += 1
  gateToken += 1
  loading.value = false
  rows.value = []
  gates.value = {}
  checkingGates.value = false
  total.value = 0
  pageIndex.value = 1
  selected.value = []
  confirmedIds.value = []
  sheetMerged.value = false
  message.value = ''
  publish()
}

watch(() => props.seedToken, () => {
  const groups = (props.procQueries ?? []).filter(item => isQueryGuid(item.id) && splitCaseVolumes(item.volumes).length > 0)
  if (groups.length) {
    void searchProcGroups(groups)
    return
  }
  const seed = props.seed
  if (!seed || !props.seedToken) {
    if (props.seedToken) clearProcQuery()
    return
  }
  const volume = props.caseVolume || seed.case_volume || ''
  const ctrl = seed.ctrl_proc ?? ''
  const fields = { ...seed }
  if (volume.length > 4000) delete fields.case_volume
  else if (volume) fields.case_volume = volume
  void search({
    type: 'all',
    caseVolume: volume,
    applicationNo: seed.app_no ?? '',
    customerName: seed.customer_name ?? '',
    ...(ctrl ? { ctrlProcId: ctrl } : {}),
    fields
  })
}, { immediate: true, flush: 'post' })
</script>

<template>
  <LimitPage
    embedded
    live
    hide-form
    selectable
    :selected="selected"
    :rows="sheetMerged ? rows : pagedRows"
    :cache-pages="sheetMerged"
    :plain-proc-ids="plainProcIds"
    :flow-by-proc="flowByProc"
    :gates="gates"
    :checking="checkingGates || Boolean(flowChecking)"
    :total="sheetMerged ? rows.length : total"
    :loading="loading"
    :message="message"
    :connected="connected"
    :page-index="pageIndex"
    :page-size="sheetMerged ? mergedPageSize : pageSize"
    :page-while-loading="sheetMerged"
    :writes-open="writesOpen"
    :writes-ready="writesReady"
    :ipr-gap="hasIprGap"
    :allow-mailed-unfinished="allowMailedUnfinished !== false"
    @page="goPage"
    @select="selected = $event"
    @confirm="onConfirm"
    @submit="onSubmitAsk"
  >
    <LimitQuerySection
      :bridge="bridge"
      :user-id="userId"
      :can-search="connected && !loading"
      :seed="seed"
      :seed-token="seedToken"
      @search="search"
    />
  </LimitPage>
</template>
