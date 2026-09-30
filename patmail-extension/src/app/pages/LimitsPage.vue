<script setup lang="ts">
import { computed, inject, onActivated, onMounted, ref, watch } from 'vue'
import LimitPage from '../../../../src/pages/LimitPage.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import BindQueryBar from '../components/BindQueryBar.vue'
import type { LimitMonitorResult, LimitMonitorRow } from '../../api/limit-monitor-types'
import { isLimitMonitorType, type LimitMonitorQuery } from '../../api/limit-monitor-params'
import { PCT_RESUME_KEY, PENDING_CUSTOMER_KEY, applyBoundQuery, matchPctMailTypes, querySnapshot } from '../../customer/mail-flow'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { fetchMailTypeNodes } from '../../customer/mail-type-load'
import { fetchMailSenders } from '../../customer/mailset-load'
import type { MailSender } from '../../customer/mailset'
import { fillSheetEmails } from '../../customer/customer-page'
import { applyPctMailTypes, clonePctTask, matchSheetCtrlProcs, pctRowsFromTable, readWorkflowTask, summarizePctTask, volumesOf, writeWorkflowTask } from '../../customer/pct-sheet'
import { limitMailItems, runLimitMailSubmit } from '../../customer/limit-mail-submit'
import { planPctRecipients, currentMailId, sheetRowsOnMail } from '../../customer/pct-recipients'
import { inventorCustomerNames, pctRuntimeFrom, recipientModeForTask, workflowSender } from '../../workflow/catalog'
import { isPctTask } from '../../customer/guards'
import type { PctTaskDraft, PctTaskRow } from '../../customer/types'
import { joinCaseVolumes, splitCaseVolumes } from '../../customer/volume-list'
import { readXlsxRows } from '../../customer/xlsx-table'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkflowCatalog } from '../composables/useWorkflowCatalog'
import { useWorkspace } from '../composables/useWorkspace'
import { infoDialog } from '../dialog'
import { useWriteSwitch } from '../../settings/use-write-switch'

const { open: writesOpen, ready: writesReady } = useWriteSwitch()
const bridge = inject<MessageBridge>('bridge')
const { connection, customers, rules, call } = useWorkspace()
const { catalog } = useWorkflowCatalog()
const pctDefinition = computed(() => catalog.value.workflows.find(item => item.id === 'pct-reminder') ?? null)
const specials = computed(() => inventorCustomerNames(pctDefinition.value))
const pctConfig = computed(() => pctRuntimeFrom(pctDefinition.value))
const workflowMailbox = computed(() => workflowSender(pctDefinition.value))
const connected = computed(() => connection.value.sessionStatus === 'authenticated')
const loading = ref(false)
const savingTask = ref(false)
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
const sheetRows = ref<PctTaskRow[]>([])
const sheetNotice = ref('')
const sheetFileName = ref('')
const sheetInput = ref<HTMLInputElement | null>(null)
const mailNodes = ref<Array<{ id: string; name: string }>>([])
const mailTypeMessage = ref('正在从原网站读取发文类型…')
const mailsets = ref<MailSender[]>([])
const mailsetId = ref('')
const senderTouched = ref(false)
const activeVolume = ref('')
const appendingContacts = ref(false)
const mailsetMessage = ref('正在从原网站读取发件邮箱…')
const ctrlOptions = ref<Array<{ id: string; label: string; parentId?: string }>>([])
const ctrlListMessage = ref('')
const mailsetOptions = computed(() => {
  const items = mailsets.value.map(item => ({ value: item.id, label: item.label }))
  if (mailsetId.value && !items.some(item => item.value === mailsetId.value)) {
    const saved = pctCustomer.value?.mailsetId === mailsetId.value
      ? pctCustomer.value.mailsetLabel
      : workflowMailbox.value?.id === mailsetId.value
        ? workflowMailbox.value.label
        : rules.value?.defaultSender?.mailsetId === mailsetId.value
          ? rules.value.defaultSender.label
          : ''
    items.unshift({ value: mailsetId.value, label: saved || '已保存的发件邮箱' })
  }
  return items
})
const mailMatch = computed(() => matchPctMailTypes(mailNodes.value, pctConfig.value))
const sheetMerged = ref(false)
const lastQuery = ref<Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> | null>(null)

const pctCustomer = computed(() => {
  const pending = sessionStorage.getItem(PENDING_CUSTOMER_KEY) || ''
  const marked = customers.value.filter(item => item.workflowId === 'pct-reminder' && item.querySurface === 'limit')
  return marked.find(item => item.id === pending) ?? marked[0] ?? null
})
const workflowTask = ref<PctTaskDraft | null>(readWorkflowTask())
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
const activeRow = computed(() => sheetRows.value.find(row => row.ourVolume === activeVolume.value) ?? null)

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

async function loadCtrlProcs(force: boolean): Promise<void> {
  if (!bridge || !connected.value) {
    ctrlOptions.value = []
    ctrlListMessage.value = '还没连接 EASY，处理事项列表还没读取。'
    return
  }
  ctrlListMessage.value = '正在从原网站读取处理事项…'
  try {
    const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'picker', force } })
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'picker') {
      ctrlOptions.value = []
      ctrlListMessage.value = response.type === MessageType.Error
        ? response.payload.message
        : response.type === MessageType.DictionaryResult && !response.payload.ok
          ? response.payload.error.message
          : '处理事项列表没有从原网站读到。'
      return
    }
    const dictionary = response.payload.data.dictionaries.limitCtrlProc
    ctrlOptions.value = (dictionary?.options ?? []).map(item => ({
      id: item.value,
      label: item.label,
      ...(item.parentValue ? { parentId: item.parentValue } : {})
    }))
    ctrlListMessage.value = ctrlOptions.value.length ? '' : '原网站没有返回处理事项。'
  } catch {
    ctrlOptions.value = []
    ctrlListMessage.value = '读取处理事项失败。'
  }
}

async function ctrlForSheet(): Promise<{ id: string; message: string }> {
  const chosen = selectedCtrl()
  if (chosen) return { id: chosen, message: '' }
  if (!ctrlOptions.value.length) await loadCtrlProcs(false)
  const matched = matchSheetCtrlProcs(sheetRows.value.map(row => row.procLabel), ctrlOptions.value)
  if (!matched.ok) return { id: '', message: ctrlListMessage.value || matched.message }
  return { id: matched.ids, message: '' }
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

function onSubmitAsk(): void {
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
  const planned = limitMailItems({
    procIds: confirmedIds.value.length ? confirmedIds.value : (task?.confirmedProcIds ?? []),
    rows: rows.value,
    sheetRows: task?.rows ?? [],
    mode: recipientModeForTask(task, catalog.value.workflows)
  })
  if (!planned.ok) {
    message.value = planned.message
    return
  }
  message.value = '正在创建发文并提交给当前登录人。'
  void runLimitMailSubmit(bridge, connection.value.operatorId, planned.items, gates.value).then(text => {
    message.value = text
  })
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
    workflowTask.value = next
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
  if (sheetRows.value.length) sheetRows.value = applyPctMailTypes(sheetRows.value, mailNodes.value, pctConfig.value)
}

async function loadMailSets(force: boolean): Promise<void> {
  if (!bridge || !connected.value) {
    mailsets.value = []
    mailsetMessage.value = '还没连接 EASY，发件邮箱还没读取。'
    return
  }
  mailsetMessage.value = '正在从原网站读取发件邮箱…'
  const loaded = await fetchMailSenders(bridge, force)
  mailsets.value = loaded.items
  mailsetMessage.value = loaded.message
}

watch(connected, (ok) => {
  if (ok) {
    void loadMailTypes(false)
    void loadMailSets(false)
    void loadCtrlProcs(false)
  }
}, { immediate: true })

watch(pctConfig, () => {
  if (sheetRows.value.length) sheetRows.value = applyPctMailTypes(sheetRows.value, mailNodes.value, pctConfig.value)
})

function preferredSenderId(): string {
  return pctCustomer.value?.mailsetId || workflowMailbox.value?.id || rules.value?.defaultSender?.mailsetId || ''
}

watch(() => pctCustomer.value?.id, () => {
  senderTouched.value = false
  mailsetId.value = preferredSenderId()
  activeVolume.value = ''
}, { immediate: true })

watch(() => rules.value?.defaultSender?.mailsetId, () => {
  if (senderTouched.value || pctCustomer.value?.mailsetId) return
  mailsetId.value = preferredSenderId()
})

watch(() => workflowMailbox.value?.id, () => {
  if (senderTouched.value || pctCustomer.value?.mailsetId) return
  mailsetId.value = preferredSenderId()
})

function chooseSender(value: string): void {
  senderTouched.value = true
  mailsetId.value = value
}

function useDefaultSender(): void {
  senderTouched.value = false
  mailsetId.value = workflowMailbox.value?.id || rules.value?.defaultSender?.mailsetId || ''
}

function writeActive(field: 'mailTo' | 'mailCc', value: string): void {
  const volume = activeVolume.value
  if (!volume) return
  sheetRows.value = sheetRows.value.map(row => row.ourVolume === volume ? { ...row, [field]: value } : row)
}

function showSheetHelp(): void {
  const customer = mailTypeMessage.value
    ? mailTypeMessage.value
    : `有客户文号：${mailMatch.value.customerVolume?.name || '原网站这次没有返回这一项'}\n只有我方文号：${mailMatch.value.ourVolumeShenzhen?.name || '原网站这次没有返回这一项'}`
  void infoDialog({
    title: 'PCT 提醒表格',
    message: `客户管理里把查询入口选成期限监控，并选择 PCT提醒 之后，传入表格就能创建任务。\n\n上传后按表格里的处理事项名称，到原网站列表里对上，再用我方文号查询。\n\n发文类型从原网站读取：\n${customer}`
  })
}

async function onSheet(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  sheetFileName.value = file.name
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    sheetRows.value = []
    sheetNotice.value = '请传入 xlsx 表格。'
    return
  }
  try {
    const parsed = pctRowsFromTable(await readXlsxRows(await file.arrayBuffer()), [], pctConfig.value)
    sheetRows.value = applyPctMailTypes(parsed.rows, mailNodes.value, pctConfig.value)
    sheetNotice.value = parsed.notice
    if (sheetRows.value.length) await querySheet('batch')
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
  const resolved = await ctrlForSheet()
  const ctrl = resolved.id
  if (!ctrl) {
    message.value = resolved.message
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
    if (!rows.value.length && volumes.length > 1 && !message.value.includes('登录')) await queryEach(volumes, ctrl)
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

async function appendSheetContacts(): Promise<void> {
  if (!bridge || !pctCustomer.value) {
    message.value = '先在客户管理把查询入口选成期限监控，并选择 PCT提醒。'
    return
  }
  if (!sheetRows.value.length) {
    message.value = '先传入 PCT 表格。'
    return
  }
  appendingContacts.value = true
  message.value = '正在读取当前发文和联系人…'
  try {
    const page = await bridge.request({ type: MessageType.GetPageInfo })
    const mailId = page.type === MessageType.PageInfo ? currentMailId(page.payload.url) : null
    if (!mailId) {
      message.value = '请先打开这一行的发文页。联系人跟这封信走，不按客户去找别的发文。'
      return
    }
    const addresses = await bridge.request({ type: MessageType.ReadMailAddresses, payload: { mailId } })
    if (addresses.type !== MessageType.MailAddressResult) {
      message.value = '当前发文没有读到，收件人和抄送没有改。'
      return
    }
    if (!addresses.payload.ok) {
      message.value = addresses.payload.error.message
      return
    }
    const matched = sheetRowsOnMail(sheetRows.value, addresses.payload.data.caseVolumes)
    if (matched.length !== 1) {
      message.value = matched.length === 0
        ? '当前发文上的文号不在这张表格里，收件人和抄送没有改。'
        : '这封发文对上了表格里的多行。一行是一个发文任务，没有改。'
      return
    }
    const row = matched[0]
    if (!row) return
    const contacts = await bridge.request({
      type: MessageType.ReadMailContacts,
      payload: { mailId, customerId: addresses.payload.data.customerId }
    })
    if (contacts.type !== MessageType.MailContactResult) {
      message.value = '发文联系人没有读到，收件人和抄送没有改。'
      return
    }
    if (!contacts.payload.ok) {
      message.value = contacts.payload.error.message
      return
    }
    let baseTo = row.mailTo ?? ''
    let baseCc = row.mailCc ?? ''
    const notes = contacts.payload.data.message ? [contacts.payload.data.message] : []
    if (!baseTo.trim()) baseTo = addresses.payload.data.to
    if (!baseCc.trim()) baseCc = addresses.payload.data.cc
    const plan = planPctRecipients([row], contacts.payload.data.rows, { to: baseTo, cc: baseCc }, specials.value, recipientModeForTask(workflowTask.value, catalog.value.workflows))
    sheetRows.value = sheetRows.value.map(item => item.ourVolume === row.ourVolume ? { ...item, mailTo: plan.to, mailCc: plan.cc } : item)
    activeVolume.value = row.ourVolume
    message.value = [...notes, ...plan.notes, `已追加到文号 ${row.ourVolume} 这一行。加载这封发文时原网站填上的地址还在前面。`].filter(Boolean).join('')
  } finally {
    appendingContacts.value = false
  }
}

function restoreSheet(force = false): void {
  workflowTask.value = readWorkflowTask()
  const task = workflowTask.value ?? pctCustomer.value?.pctTask
  if (!task || (sheetRows.value.length && !force)) return
  sheetRows.value = task.rows.map(row => ({ ...row }))
  if (task.mailsetId) mailsetId.value = task.mailsetId
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
  restoreSheet(true)
  if (!connected.value) {
    message.value = '任务已经记下。连上 EASY 之后，可以用我方文号再查一次。'
    return
  }
  seedQuery(splitCaseVolumes(caseVolume), ctrl)
  await search({ type: 'all', caseVolume, ctrlProcId: ctrl, fields: { case_volume: caseVolume, ctrl_proc: ctrl } })
}

onMounted(() => { void resumeQuery() })
onActivated(() => { void resumeQuery() })

async function createTask(): Promise<void> {
  const customer = pctCustomer.value
  if (!sheetRows.value.length) {
    message.value = '先传入 PCT 表格。'
    return
  }
  sheetRows.value = applyPctMailTypes(sheetRows.value, mailNodes.value, pctConfig.value)
  let emailNote = ''
  if (bridge && customer && isQueryGuid(customer.easyCustomerId ?? '')) {
    const directory = await bridge.request({ type: MessageType.ReadCustomerDirectory, payload: { customerId: customer.easyCustomerId ?? '' } })
    if (directory.type === MessageType.Error) {
      emailNote = directory.payload.message
    } else if (directory.type === MessageType.CustomerDirectoryResult) {
      const payload = directory.payload
      if (!payload.ok) {
        emailNote = payload.error.message
      } else {
        const filled = fillSheetEmails(sheetRows.value, payload.data.rows, specials.value, recipientModeForTask(workflowTask.value, catalog.value.workflows))
        sheetRows.value = filled.rows
        const matched = filled.rows.filter(row => (row.mailTo ?? '').includes('@') || (row.mailCc ?? '').includes('@')).length
        emailNote = [payload.data.complete ? '' : (payload.data.message || '客户联系人没有读全。'), matched ? `已为 ${matched} 行补上客户联系人里唯一的邮箱。` : '', ...filled.notes].filter(Boolean).join('')
      }
    }
  }
  if (sheetRows.value.some(row => !row.mailTypeId)) {
    message.value = '发文类型还没从原网站读全。连上 EASY 后点重新读取，再创建任务。'
    return
  }
  const resolved = await ctrlForSheet()
  const ctrl = resolved.id
  if (!ctrl) {
    message.value = resolved.message
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
  const chosenId = mailsetId.value || rules.value?.defaultSender?.mailsetId || ''
  const picked = mailsets.value.find(item => item.id === chosenId)
  const fromRules = rules.value?.defaultSender?.mailsetId === chosenId ? rules.value.defaultSender : null
  const fromCustomer = customer && customer.mailsetId === chosenId && customer.mailsetLabel
    ? { mailsetId: customer.mailsetId, label: customer.mailsetLabel }
    : null
  const sender = picked
    ? { mailsetId: picked.id, label: picked.label }
    : fromRules ?? fromCustomer
  const task: PctTaskDraft = {
    workflowId: workflowTask.value?.workflowId && /^[a-z][a-z0-9-]{0,40}$/.test(workflowTask.value.workflowId) ? workflowTask.value.workflowId : 'pct-reminder',
    recipientMode: recipientModeForTask(workflowTask.value, catalog.value.workflows),
    ctrlProcId: ctrl,
    rows: sheetRows.value,
    confirmedProcIds: confirmedIds.value.filter(item => isQueryGuid(item)),
    ...(sender ? { mailsetId: sender.mailsetId, mailsetLabel: sender.label } : {}),
    createdAt: new Date().toISOString()
  }
  if (!isPctTask(task)) {
    message.value = sheetRows.value.some(row => (row.mailTo?.length ?? 0) > 4000 || (row.mailCc?.length ?? 0) > 4000)
      ? '某一行的收件人或抄送太长，任务没有保存。'
      : '这张表格组不成任务。'
    return
  }
  savingTask.value = true
  if (!customer || workflowTask.value) {
    const saved = clonePctTask(task)
    writeWorkflowTask(saved)
    workflowTask.value = saved
    sessionStorage.removeItem(PENDING_CUSTOMER_KEY)
    savingTask.value = false
    submittedFields.value = fields
    const savedText = sender
      ? `已按表格创建任务，发件人是 ${sender.label}。${summarizePctTask(task)}任务记在插件里，还不会提交到 EASY。`
      : `已按表格创建任务。这次没有发件人，规则里也还没设默认。${summarizePctTask(task)}任务记在插件里，还不会提交到 EASY。`
    seedQuery(volumes, ctrl)
    await search({ type: 'all', caseVolume, ctrlProcId: ctrl, fields: { case_volume: caseVolume, ctrl_proc: ctrl } })
    message.value = `${savedText}${emailNote ? ` ${emailNote}` : ''}${message.value ? ` ${message.value}` : ''}`
    return
  }
  const next = applyBoundQuery(customer, {
    surface: 'limit',
    fields,
    templateId: templateId.value,
    reviewSelf: customer.reviewTarget === 'self'
  })
  next.pctTask = clonePctTask(task)
  if (sender && senderTouched.value) {
    next.mailsetId = sender.mailsetId
    next.mailsetLabel = sender.label
  }
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
  const savedText = sender
    ? `已按表格创建任务，发件人是 ${sender.label}。${summarizePctTask(task)}任务记在插件里，还不会提交到 EASY。`
    : `已按表格创建任务。这次没有发件人，规则里也还没设默认。${summarizePctTask(task)}任务记在插件里，还不会提交到 EASY。`
  seedQuery(volumes, ctrl)
  await search({ type: 'all', caseVolume, ctrlProcId: ctrl, fields: { case_volume: caseVolume, ctrl_proc: ctrl } })
  message.value = `${savedText}${emailNote ? ` ${emailNote}` : ''}${message.value ? ` ${message.value}` : ''}`
}
</script>

<template>
  <LimitPage live hide-form selectable :writes-open="writesOpen" :writes-ready="writesReady" :selected="selected" :rows="rows" :gates="gates" :checking="checkingGates" :total="sheetMerged ? rows.length : total" :loading="loading" :message="message" :connected="connected" :page-index="pageIndex" :page-size="shownPageSize" @page="goPage" @select="onSelect" @confirm="onConfirm" @submit="onSubmitAsk">
    <section v-if="!connected" class="card"><p class="empty">尚未确认 EASY 用户，不能读取期限模板。</p></section>
    <template v-else>
      <LimitQuerySection :bridge="bridge" :user-id="connection.operatorId" :can-search="connected && !loading" :seed="seed" :seed-token="seedToken" @search="search" @draft="draftFields = $event" />
      <section class="card">
        <div class="section-heading">
          <strong>PCT 提醒表格</strong>
          <span>
            <button type="button" class="text-button" @click="loadMailTypes(true)">重新读取</button>
            <button type="button" class="text-button" @click="showSheetHelp">详情</button>
          </span>
        </div>
        <p class="hint">传入 xlsx 后，按表格里的处理事项到原网站对上，再用我方文号查询。</p>
        <p v-if="mailTypeMessage" class="hint">{{ mailTypeMessage }}</p>
        <p v-if="workflowTask" class="hint">这次按工作流记下：{{ summarizePctTask(workflowTask) }}</p>
        <p v-else-if="pctCustomer" class="hint">当前客户：{{ pctCustomer.name }}<template v-if="pctCustomer.pctTask">。已有任务：{{ summarizePctTask(pctCustomer.pctTask) }}</template></p>
        <div class="pct-sheet">
          <div class="pct-sheet-side">
            <label>发件人
              <ThemeSelect :model-value="mailsetId" placeholder="选择发件邮箱" empty-text="发件邮箱还没读到。点下面的重新读取。" :options="mailsetOptions" @update:model-value="chooseSender(String($event))" />
            </label>
            <button type="button" class="text-button" @click="useDefaultSender">使用默认</button>
            <div class="sheet-pick">
              <button class="ghost" type="button" :disabled="loading || savingTask" @click="sheetInput?.click()">选择表格</button>
              <span class="name">{{ sheetFileName || '尚未选择' }}</span>
              <input ref="sheetInput" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="loading || savingTask" @change="onSheet" />
            </div>
            <p v-if="sheetNotice" class="hint">{{ sheetNotice }}</p>
            <p v-if="sheetRows.length" class="hint">{{ sheetSummary }}</p>
            <div class="pct-sheet-actions">
              <button class="solid" type="button" :disabled="loading || savingTask" @click="createTask">{{ savingTask ? '正在创建…' : '按表格创建任务' }}</button>
              <button class="ghost" type="button" :disabled="loading || savingTask" @click="querySheet('batch')">所有文号一起查询</button>
              <button class="ghost" type="button" :disabled="loading || savingTask" @click="querySheet('each')">逐个文号查询</button>
            </div>
            <p class="hint">没改的话用工作流或发文映射里保存的发件人。这里改一次，记在这次任务上。</p>
            <p v-if="!senderTouched && !pctCustomer?.mailsetId && workflowMailbox && mailsetId === workflowMailbox.id" class="hint">当前沿用工作流里选的：{{ workflowMailbox.label }}</p>
            <p v-else-if="!senderTouched && !pctCustomer?.mailsetId && rules?.defaultSender && mailsetId === rules.defaultSender.mailsetId" class="hint">当前沿用默认：{{ rules.defaultSender.label }}</p>
            <p v-if="mailsetMessage" class="hint">{{ mailsetMessage }}</p>
            <button type="button" class="text-button" @click="loadMailSets(true)">重新读取发件邮箱</button>
          </div>
          <div class="pct-sheet-side">
            <label>收件人<span v-if="activeRow">（{{ activeRow.ourVolume }}）</span>
              <textarea :value="activeRow?.mailTo ?? ''" rows="3" maxlength="4000" placeholder="名称(邮箱);" :disabled="!activeRow" @input="writeActive('mailTo', ($event.target as HTMLTextAreaElement).value)" />
            </label>
            <label>抄送<span v-if="activeRow">（{{ activeRow.ourVolume }}）</span>
              <textarea :value="activeRow?.mailCc ?? ''" rows="3" maxlength="4000" placeholder="名称(邮箱);" :disabled="!activeRow" @input="writeActive('mailCc', ($event.target as HTMLTextAreaElement).value)" />
            </label>
            <p class="hint">打开这一行已经加载的发文后追加。PCT提醒收件人是 IPR、抄送是商务。PCT鹏城专案收件人是技术负责人、抄送是 IPR 和商务。这封发文加载时填上的地址留在前面。同一客户里收件人或抄送不同的分成另一封。查询结果里，待审核的标灰不能勾选，已经审核完成的不列出。</p>
            <button class="ghost" type="button" :disabled="loading || savingTask || appendingContacts || !sheetRows.length" @click="appendSheetContacts">{{ appendingContacts ? '正在追加…' : '按表格追加联系人' }}</button>
          </div>
        </div>
      </section>
      <BindQueryBar surface="limit" show-load :fields="boundFields" :template-id="templateId" @load="loadBound" />
      <p v-if="confirmedIds.length" class="hint">已确认勾选 {{ confirmedIds.length }} 件。</p>
      <p v-else-if="selected.length" class="hint">已勾选 {{ selected.length }} 件。点结果表上的「确认勾选」才会记下来。记在插件里的任务不会因此提交到 EASY。</p>
    </template>
  </LimitPage>
</template>
