<script setup lang="ts">
import { ref, watch } from 'vue'
import LimitPage from '../../../../src/pages/LimitPage.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import type { LimitMonitorResult, LimitMonitorRow } from '../../api/limit-monitor-types'
import { isLimitMonitorType, type LimitMonitorQuery } from '../../api/limit-monitor-params'
import { clonePctTask, readWorkflowTask, writeWorkflowTask } from '../../customer/pct-sheet'
import { limitMailItems, runLimitMailSubmit } from '../../customer/limit-mail-submit'
import { beginProgress, endProgress, logProgress } from '../dialog'
import { splitCaseVolumes } from '../../customer/volume-list'
import { isQueryGuid } from '../../query/query-validator'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWriteSwitch } from '../../settings/use-write-switch'

const props = defineProps<{
  bridge?: MessageBridge
  userId: string
  connected: boolean
  seed?: Record<string, string> | null
  seedToken?: number
  caseVolume?: string
  sheetRows?: Array<{ ourVolume: string; mailTypeId?: string; customerName?: string; contactName?: string; iprName?: string; leadName?: string }>
  recipientMode?: 'ipr' | 'lead'
}>()

const { open: writesOpen, ready: writesReady } = useWriteSwitch()

const emit = defineEmits<{
  confirm: [procIds: string[]]
  result: [payload: { items: LimitMonitorRow[]; gates: Record<string, 'open' | 'pending' | 'done'>; checking: boolean; message: string }]
  refreshStatus: [targets: Array<{ caseVolume: string; procLabel: string }>]
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
const sheetMerged = ref(false)
const lastQuery = ref<Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> | null>(null)
const templateId = ref('')

type SearchInput = Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> & { reset?: boolean; templateId?: string; page?: number }

function publish(): void {
  emit('result', {
    items: rows.value.slice(),
    gates: { ...gates.value },
    checking: loading.value || checkingGates.value,
    message: message.value
  })
}

function textFor(code: string, fallback: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'HTTP_ERROR') return 'EASY 暂时没有返回列表，可以再查一次。'
  if (code === 'INVALID_QUERY') return fallback || '请输入查询条件。'
  return fallback || '期限查询失败，请稍后重试。'
}

async function requestPage(query: LimitMonitorQuery): Promise<LimitMonitorResult> {
  if (!props.bridge || !props.connected) throw '尚未连接 EASY。'
  const response = await props.bridge.request({ type: MessageType.SearchLimitMonitor, payload: { query } })
  if (response.type === MessageType.Error) throw response.payload.message
  if (response.type !== MessageType.SearchLimitMonitorResult) throw '期限查询返回了意外结果。'
  if (!response.payload.ok) throw textFor(response.payload.error.code, response.payload.error.message)
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
  gates.value = merge ? { ...gates.value, ...next } : next
  checkingGates.value = false
  if (merge) {
    publish()
    return
  }
  selected.value = selected.value.filter(id => next[id] === 'open' || next[id] === 'done')
  const pending = items.filter(row => next[row.procId] === 'pending').length
  const bits = [
    pending ? `待审核 ${pending} 个，已标灰，不能勾选。` : '',
    failed ? `${failed} 件没有读到发文流程，先按待审核处理。` : '',
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
  if (!lastQuery.value || loading.value || sheetMerged.value) return
  void search({ ...lastQuery.value, page })
}

function onConfirm(ids: string[]): void {
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
  if (stored) writeWorkflowTask(clonePctTask({ ...stored, confirmedProcIds: procIds }))
  message.value = `已确认勾选 ${procIds.length} 件。再点「提交到 EASY」会创建发文并交给当前登录人。`
  emit('confirm', procIds)
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
  if (!props.bridge || !props.connected) {
    message.value = '尚未连接 EASY。'
    return
  }
  const task = readWorkflowTask()
  const planned = limitMailItems({
    procIds: confirmedIds.value.length ? confirmedIds.value : (task?.confirmedProcIds ?? []),
    rows: rows.value,
    sheetRows: props.sheetRows?.length ? props.sheetRows : (task?.rows ?? []),
    mode: props.recipientMode ?? (task?.recipientMode === 'lead' || task?.recipientMode === 'ipr' ? task.recipientMode : 'ipr')
  })
  if (!planned.ok) {
    message.value = planned.message
    return
  }
  message.value = '正在创建发文并提交给当前登录人。'
  const involved = rows.value.filter(row => planned.items.some(item => item.procId === row.procId))
  beginProgress('提交到 EASY', planned.items.length + 1)
  const notes: string[] = []
  for (let index = 0; index < planned.items.length; index += 1) {
    const item = planned.items[index]
    const row = involved.find(entry => entry.procId === item?.procId)
    const label = row?.caseVolume || item?.procId || ''
    logProgress(`正在处理 ${label}。`, index)
    const text = await runLimitMailSubmit(props.bridge, props.userId, item ? [item] : [])
    notes.push(text)
    logProgress(`${label}：${text}`, index + 1)
    if (item && text.startsWith('已提交')) {
      confirmedIds.value = confirmedIds.value.filter(id => id !== item.procId)
    }
    if (/无法确认|没有再次|写开关|没有提交到审核人|登录已失效/.test(text) && !text.startsWith('已提交')) break
  }
  emit('confirm', confirmedIds.value)
  logProgress('正在回传所涉及案件的审核状态。', planned.items.length)
  await markSendGates(involved, true)
  emit('refreshStatus', involved.map(row => ({ caseVolume: row.caseVolume, procLabel: row.ctrlProc })))
  message.value = notes.filter(Boolean).join('')
  publish()
}

watch(() => props.seedToken, () => {
  const seed = props.seed
  if (!seed || !props.seedToken) return
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
}, { immediate: true })
</script>

<template>
  <LimitPage
    embedded
    live
    hide-form
    selectable
    :selected="selected"
    :rows="rows"
    :gates="gates"
    :checking="checkingGates"
    :total="sheetMerged ? rows.length : total"
    :loading="loading"
    :message="message"
    :connected="connected"
    :page-index="pageIndex"
    :page-size="sheetMerged ? Math.max(rows.length, 1) : pageSize"
    :writes-open="writesOpen"
    :writes-ready="writesReady"
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
