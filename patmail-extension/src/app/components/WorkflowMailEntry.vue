<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from 'vue'
import MailTypeTreeSelect from '../../shell/components/MailTypeTreeSelect.vue'
import ThemeSelect from '../../shell/components/ThemeSelect.vue'
import EmptyGuide from './EmptyGuide.vue'
import LimitMonitorQuery from './LimitMonitorQuery.vue'
import type { MailSender } from '../../customer/mailset'
import { PCT_RESUME_KEY, PENDING_CUSTOMER_KEY } from '../../customer/mail-flow'
import { fillSheetEmails } from '../../customer/customer-page'
import { IC_LOOKUP_WIDTH } from '../../customer/ic-flow-lookup'
import { iprArbitrationWaves, isPctWorkbookSheet, missedSourceSheets, pctRowsFromWorkbook } from '../../customer/pct-workbook'
import { applyPctMailTypes, buildPctTask, clonePctTask, matchSheetCtrlProcs, readWorkflowTask, summarizePctTask, volumesOf, writeWorkflowTask } from '../../customer/pct-sheet'
import type { CustomerQueryProfile, PctTaskRow } from '../../customer/types'
import { groupWorkflowRows } from '../../customer/workflow-mail'
import { arbitratedMark, carriedMark, sheetDisplayName, sheetRecipientNames, usesInventorSheet } from '../../customer/pct-recipients'
import { inventorCustomerNames, isRunnableWorkflow, recipientModeOf } from '../../workflow/catalog'
import { downloadXlsxSheets, readXlsxSheets } from '../../customer/xlsx-table'
import { assembleMail, fillFromRules } from '../../mail'
import type { AssembledMail } from '../../mail/assemble'
import type { MailRuleBundle, SelectedPatentFile } from '../../mail/types'
import { joinCaseVolumes } from '../../customer/volume-list'
import type { LimitMonitorRow } from '../../api/limit-monitor-types'
import { isQueryGuid } from '../../query/query-validator'
import { MessageType, type MessageBridge } from '../../shared/message'
import { scopeFromConnection } from '../../shared/connection'
import { useWorkspace } from '../composables/useWorkspace'
import { endProgress, logProgress, progressSummaryLine } from '../dialog'
import { FILE_MANAGE_ID, packagedPctWorkflow, pctRuntimeFrom, workflowSender, type WorkflowCatalog, type WorkflowDefinition } from '../../workflow/catalog'
import FileManageMail from './FileManageMail.vue'

const props = defineProps<{
  customers: CustomerQueryProfile[]
  rules: MailRuleBundle | null
  operatorId: string
  mailTypes: Array<{ id: string; name: string; parentId: string }>
  senders: MailSender[]
  signatureName: string
  signatureText: string
  catalog: WorkflowCatalog
}>()

const bridge = inject<MessageBridge>('bridge')
const { connection, call } = useWorkspace()
const saving = ref(false)
const workflowId = ref('pct-reminder')
const sheetName = ref('')
const sheetNotice = ref('')
const rows = ref<PctTaskRow[]>([])
const senderTouched = ref(false)
const senderId = ref('')
const status = ref('')
const previews = ref<AssembledMail[]>([])
const cards = ref<Array<{ count: number; to: string; cc: string; sender: string; gaps: string[] }>>([])
const progress = ref<Array<{ label: string; detail: string; state: 'wait' | 'run' | 'done' | 'stop' }>>([])
const queryOpen = ref(false)
const querySeed = ref<Record<string, string> | null>(null)
const queryProcs = ref<Array<{ id: string; volumes: string }>>([])
const queryToken = ref(0)
const queryCaseVolume = ref('')
const limitPhase = ref<'idle' | 'run' | 'done' | 'fail'>('idle')
const limitNote = ref('')
const icPhase = ref<'idle' | 'run' | 'done' | 'fail'>('idle')
const icNote = ref('')
type IcHit = { found: boolean; gate: '' | 'open' | 'pending' | 'done'; unread?: true; statusUnread?: true }
const icByKey = reactive<Record<string, IcHit>>({})
const limitByKey = reactive<Record<string, string>>({})
const gapWaves = ref<string[]>([])
const sheetPage = ref(1)
const askingGap = ref(false)
const abnormalKeys = ref(new Set<string>())
const confirmedProcIds = ref<string[]>([])
let sheetQueryToken = 0
let sheetImportToken = 0
const SHEET_PAGE_SIZE = 100

const definition = computed(() => props.catalog.workflows.find(item => item.id === workflowId.value) ?? null)
const specials = computed(() => inventorCustomerNames(definition.value))
const inventorCustomers = computed(() => [...specials.value])
const recipientMode = computed(() => recipientModeOf(definition.value))
const runnable = computed(() => isRunnableWorkflow(definition.value))
const runtime = computed(() => pctRuntimeFrom(runnable.value ? definition.value : null))
const packaged = computed(() => definition.value && runnable.value ? packagedPctWorkflow(definition.value) : null)
const workflowOptions = computed(() => props.catalog.workflows.map(item => ({
  value: item.id,
  label: item.label
})))
const mailTypeOptions = computed(() => props.mailTypes.map(item => ({
  value: item.id,
  label: item.name,
  ...(item.parentId ? { parent: item.parentId } : {})
})))

const resolvedSender = computed(() => {
  const flow = workflowSender(definition.value)
  const saved = flow
    ? { mailsetId: flow.id, label: flow.label }
    : props.rules?.defaultSender ?? null
  if (senderTouched.value) {
    const picked = props.senders.find(item => item.id === senderId.value)
    return picked ? { mailsetId: picked.id, label: picked.label } : saved
  }
  return saved
})
const senderMissing = computed(() => runnable.value && !resolvedSender.value)
const senderOptions = computed(() => {
  const items = props.senders.map(item => ({ value: item.id, label: item.label }))
  const current = resolvedSender.value
  if (current && !items.some(item => item.value === current.mailsetId)) items.unshift({ value: current.mailsetId, label: current.label })
  return items
})

const styleNotes = computed(() => {
  const names = [...new Set(rows.value.map(row => row.customerName.trim()).filter(Boolean))]
  return names.flatMap(name => {
    const profile = props.customers.find(item => item.enabled !== false && item.name.trim() === name)
    if (!profile?.limitMailStyle || profile.limitMailStyle === '1') return []
    const label = packaged.value?.modes.find(item => item.id === 'mail_style')?.options?.find(item => item.value === profile.limitMailStyle)?.label
    return [`「${name}」在客户管理里保存的发文方式是${label ? `「${label}」` : '另一种'}。发到原网站时会按保存的方式。`]
  })
})
const offCount = computed(() => rows.value.filter(row => row.procLabel && row.procLabel !== runtime.value.procLabel).length)
const pendingRows = computed(() => rows.value.filter(row => sheetStatus(row).review === '还没提交审核'))
const outcome = computed(() => {
  if (!rows.value.length) return ''
  let pending = 0
  let submitted = 0
  let done = 0
  let missing = 0
  let unread = 0
  let noProc = 0
  let statusMiss = 0
  let checking = 0
  let abnormal = 0
  for (const row of rows.value) {
    const status = sheetStatus(row)
    if (status.review === '异常') abnormal += 1
    else if (status.found === '库里没有') missing += 1
    else if (status.found === '没查成') unread += 1
    else if (status.found === '正在查' || status.review === '…') checking += 1
    else if (status.review === '还没提交审核') pending += 1
    else if (status.review === '已提交审核') submitted += 1
    else if (status.review === '已经审核通过') done += 1
    else if (status.review === '没有这项处理事项') noProc += 1
    else if (status.review === '状态没读到') statusMiss += 1
    else if (icPhase.value === 'run') checking += 1
    else missing += 1
  }
  const letters = pending && icPhase.value !== 'run' ? groupWorkflowRows('1', rows.value.filter(row => sheetStatus(row).review === '还没提交审核'), specials.value, recipientMode.value).length : 0
  return [
    pending ? (letters ? `还有 ${pending} 行待处理，会分成 ${letters} 封。` : `还有 ${pending} 行待处理。`) : '没有待处理的行。',
    submitted ? `已提交审核 ${submitted} 行。` : '',
    done ? `已经审核通过 ${done} 行。` : '',
    missing ? `库里没有 ${missing} 行。` : '',
    unread ? `没查成 ${unread} 行。` : '',
    noProc ? `没有这项处理事项 ${noProc} 行。` : '',
    statusMiss ? `状态没读到 ${statusMiss} 行。` : '',
    abnormal ? `异常 ${abnormal} 行。` : '',
    checking ? `还有 ${checking} 行正在核对。` : ''
  ].filter(Boolean).join('')
})
const outcomeGroups = computed(() => {
  if (icPhase.value === 'run') return []
  const groups = groupWorkflowRows('1', pendingRows.value, specials.value, recipientMode.value)
  if (groups.length < 2 || groups.length > 6) return []
  return groups.map(group => {
    const to = people(group, 'to')
    const cc = people(group, 'cc')
    const who = cc && cc !== '表格里没有' ? `${to}，抄送 ${cc}` : to
    return `${who} ${group.length} 行`
  })
})

const unmatched = computed(() => rows.value.filter(row => !row.mailTypeId))
const sheetPages = computed(() => Math.max(1, Math.ceil(rows.value.length / SHEET_PAGE_SIZE)))
const sheetPageSafe = computed(() => Math.min(sheetPage.value, sheetPages.value))
const sheetSeen = ref<number[]>([1])
watch(sheetPageSafe, (page) => {
  if (!sheetSeen.value.includes(page)) sheetSeen.value = [...sheetSeen.value, page]
})

function rowsOnSheetPage(page: number): PctTaskRow[] {
  const start = (page - 1) * SHEET_PAGE_SIZE
  return rows.value.slice(start, start + SHEET_PAGE_SIZE)
}

function resetSheetPages(): void {
  sheetPage.value = 1
  sheetSeen.value = [1]
}

function setSheetPage(page: number): void {
  sheetPage.value = Math.min(Math.max(1, page), sheetPages.value)
}

watch(workflowId, () => {
  rows.value = []
  abnormalKeys.value = new Set()
  sheetName.value = ''
  sheetNotice.value = ''
  previews.value = []
  cards.value = []
  progress.value = []
  status.value = ''
  senderTouched.value = false
  resetLimit()
})

watch(resolvedSender, (sender) => {
  if (senderTouched.value || !sender) return
  senderId.value = sender.mailsetId
}, { immediate: true })

function chooseSender(value: string): void {
  senderTouched.value = true
  senderId.value = value
  if (rows.value.length) buildPreview()
}

async function onSheet(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  previews.value = []
  cards.value = []
  progress.value = []
  status.value = ''
  abnormalKeys.value = new Set()
  resetLimit()
  if (!file) return
  sheetName.value = file.name
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
  rows.value = []
  gapWaves.value = []
  sheetNotice.value = '请传入表格文件。'
    return
  }
  const generation = ++sheetImportToken
  sheetNotice.value = '正在读取表格…'
  try {
    await new Promise(resolve => window.setTimeout(resolve, 0))
    if (generation !== sheetImportToken) return
    const parsed = pctRowsFromWorkbook(await readXlsxSheets(await file.arrayBuffer(), isPctWorkbookSheet), props.mailTypes, runtime.value)
    if (generation !== sheetImportToken) return
    rows.value = applyPctMailTypes(parsed.rows, props.mailTypes, runtime.value)
    resetSheetPages()
    gapWaves.value = iprArbitrationWaves(rows.value)
    sheetNotice.value = parsed.notice
    await new Promise(resolve => window.setTimeout(resolve, 0))
    if (generation !== sheetImportToken) return
    buildPreview()
    void startSheetQuery()
  } catch (error) {
    rows.value = []
    gapWaves.value = []
    sheetNotice.value = error instanceof Error ? error.message : '表格没有读出来。'
  }
}

function setRowType(volume: string, id: string): void {
  const name = props.mailTypes.find(item => item.id === id)?.name ?? ''
  rows.value = rows.value.map(row => row.ourVolume === volume ? { ...row, mailTypeId: id, mailTypeLabel: name } : row)
  buildPreview()
}

function filesOf(group: PctTaskRow[]): SelectedPatentFile[] {
  return group.map(row => ({
    fileId: row.ourVolume,
    fileName: row.ourVolume,
    fileDescription: row.procLabel,
    customerName: row.customerName,
    caseVolume: row.ourVolume,
    customerVolume: row.customerVolume
  }))
}

function shownTo(row: PctTaskRow): string {
  const written = row.mailTo?.trim()
  if (written) return written
  if (recipientMode.value === 'lead') return carriedMark(sheetDisplayName(row.leadName ?? ''), row.leadCarried) || '表格里没有'
  const inventor = usesInventorSheet(row.customerName, specials.value)
  if (!inventor && row.iprArbitrated && row.iprName.trim()) return arbitratedMark(row.iprName, true)
  const marked = carriedMark(inventor ? row.contactName : row.iprName, inventor ? row.contactCarried : row.iprCarried)
  return marked || '表格里没有'
}

function shownCc(row: PctTaskRow): string {
  const written = row.mailCc?.trim()
  if (written) return written
  if (recipientMode.value === 'lead') {
    const ipr = row.iprArbitrated ? arbitratedMark(row.iprName, true) : carriedMark(row.iprName, row.iprCarried)
    return ipr ? `${ipr}、商务` : '商务'
  }
  if (!usesInventorSheet(row.customerName, specials.value)) return '商务'
  if (row.iprArbitrated && row.iprName.trim()) return arbitratedMark(row.iprName, true)
  return carriedMark(row.iprName, row.iprCarried) || '表格里没有'
}

function carriedContactNote(row: PctTaskRow): string {
  if (!row.contactCarried || usesInventorSheet(row.customerName, specials.value)) return ''
  const marked = carriedMark(row.contactName, true)
  return marked ? `第一客户联系人 ${marked}` : ''
}

function clearHits(): void {
  for (const key of Object.keys(icByKey)) delete icByKey[key]
  for (const key of Object.keys(limitByKey)) delete limitByKey[key]
}

function resetLimit(): void {
  sheetQueryToken += 1
  resetSheetPages()
  queryOpen.value = false
  querySeed.value = null
  queryProcs.value = []
  queryCaseVolume.value = ''
  limitPhase.value = 'idle'
  limitNote.value = ''
  icPhase.value = 'idle'
  icNote.value = ''
  clearHits()
}

function volumeKey(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

function statusShade(text: string): string {
  if (text === '还没提交审核') return 'shade-open'
  if (text === '已经审核通过') return 'shade-done'
  if (text === '已提交审核') return 'shade-pending'
  if (text === '异常') return 'shade-abnormal'
  if (text === '库里没有' || text === '没查成') return 'shade-missing'
  return ''
}

function reviewLabel(gate: 'open' | 'pending' | 'done' | undefined): string {
  if (gate === 'pending') return '已提交审核'
  if (gate === 'done') return '已经审核通过'
  if (gate === 'open') return '还没提交审核'
  return '—'
}

function icKey(volume: string, procLabel: string): string {
  return `${volumeKey(volume)}\n${procLabel.trim()}`
}

function limitReview(row: PctTaskRow): string {
  return limitByKey[icKey(row.ourVolume, row.procLabel)] ?? ''
}

function sheetMemo(row: PctTaskRow): string {
  const status = sheetStatus(row)
  return `${status.found}\n${status.review}`
}

function sheetStatus(row: PctTaskRow): { found: string; review: string } {
  const base = sheetReview(row)
  if (abnormalKeys.value.has(icKey(row.ourVolume, row.procLabel))) return { found: base.found || '有', review: '异常' }
  return base
}

function sheetReview(row: PctTaskRow): { found: string; review: string } {
  const fromLimit = limitReview(row)
  const hit = icByKey[icKey(row.ourVolume, row.procLabel)]
  if (hit) {
    if (hit.unread) return { found: '没查成', review: '—' }
    if (hit.statusUnread) return { found: '有', review: '状态没读到' }
    if (!hit.found) {
      if (fromLimit && fromLimit !== '…') return { found: '有', review: fromLimit }
      return { found: '库里没有', review: '—' }
    }
    const fromFlow = hit.gate ? reviewLabel(hit.gate) : ''
    if (fromLimit === '还没提交审核' && fromFlow === '已经审核通过') {
      return { found: '有', review: fromLimit }
    }
    if (fromFlow === '还没提交审核' && (fromLimit === '已提交审核' || fromLimit === '已经审核通过')) {
      return { found: '有', review: fromLimit }
    }
    if (fromFlow) return { found: '有', review: fromFlow }
    if (fromLimit && fromLimit !== '…') return { found: '有', review: fromLimit }
    return { found: '有', review: fromLimit === '…' ? '…' : '没有这项处理事项' }
  }
  if (fromLimit) return { found: '有', review: fromLimit }
  if (icPhase.value === 'fail') return { found: '没查成', review: '—' }
  if (icPhase.value === 'run') return { found: '正在查', review: '…' }
  if (icPhase.value === 'done') return { found: '库里没有', review: '—' }
  return { found: '', review: '' }
}

async function lookupCases(token: number): Promise<void> {
  icPhase.value = 'run'
  for (const key of Object.keys(icByKey)) delete icByKey[key]
  icNote.value = '正在用案件查询核对文号和流程状态…'
  if (!bridge || connection.value.sessionStatus !== 'authenticated') {
    icPhase.value = 'fail'
    icNote.value = '还没连上 EASY，库里有没有还没查。'
    return
  }
  const page = bridge
  const seen = new Set<string>()
  const asked = rows.value.flatMap(row => {
    const caseVolume = row.ourVolume.trim()
    const procLabel = row.procLabel.trim()
    if (!caseVolume || !procLabel) return []
    const key = icKey(caseVolume, procLabel)
    if (seen.has(key)) return []
    seen.add(key)
    return [{ caseVolume, procLabel, tries: 0 }]
  })
  const total = asked.length
  type Hit = { found: boolean; gate: '' | 'open' | 'pending' | 'done'; unread?: true; statusUnread?: true }
  const next: Record<string, Hit> = {}
  const pending: Record<string, Hit> = {}
  let flushTimer = 0
  let stopped = ''
  const lanes = 5

  function flush(): void {
    if (flushTimer) {
      window.clearTimeout(flushTimer)
      flushTimer = 0
    }
    if (token !== sheetQueryToken || !Object.keys(pending).length) return
    Object.assign(next, pending)
    for (const key of Object.keys(pending)) {
      icByKey[key] = pending[key]
      delete pending[key]
    }
    icNote.value = `正在核对 ${Object.keys(next).length}/${total}…`
  }

  function stage(key: string, hit: Hit): void {
    pending[key] = hit
    if (Object.keys(pending).length >= 24) flush()
    else if (!flushTimer) flushTimer = window.setTimeout(flush, 500)
  }

  function store(item: { caseVolume: string; procLabel: string; found: boolean; gate: '' | 'open' | 'pending' | 'done'; unread?: true; statusUnread?: true }): void {
    const key = icKey(item.caseVolume, item.procLabel)
    if (item.unread) stage(key, { found: false, gate: '', unread: true })
    else if (item.statusUnread) stage(key, { found: true, gate: '', statusUnread: true })
    else stage(key, { found: item.found, gate: item.gate })
  }

  async function worker(): Promise<void> {
    while (token === sheetQueryToken && !stopped) {
      const job = asked.shift()
      if (!job) return
      const response = await page.request({ type: MessageType.LookupIcFlow, payload: { rows: [{ caseVolume: job.caseVolume, procLabel: job.procLabel }] } })
      if (token !== sheetQueryToken) return
      if (response.type !== MessageType.LookupIcFlowResult || !response.payload.ok) {
        const message = response.type === MessageType.LookupIcFlowResult && !response.payload.ok
          ? response.payload.error.message
          : response.type === MessageType.Error
            ? response.payload.message
            : '案件查询没有完成。'
        if (/登录/.test(message)) {
          stopped = message
          return
        }
        if (job.tries < 1) {
          asked.push({ ...job, tries: job.tries + 1 })
          continue
        }
        stage(icKey(job.caseVolume, job.procLabel), { found: false, gate: '', unread: true })
        continue
      }
      const item = response.payload.data.items[0]
      if (!item) continue
      if (item.unread && job.tries < 1) {
        asked.push({ caseVolume: item.caseVolume, procLabel: item.procLabel, tries: job.tries + 1 })
        continue
      }
      store(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(lanes, Math.max(asked.length, 1)) }, () => worker()))
  if (flushTimer) window.clearTimeout(flushTimer)
  if (token !== sheetQueryToken) return
  flush()
  if (stopped) {
    icPhase.value = 'fail'
    icNote.value = stopped
    return
  }
  icPhase.value = 'done'
  const found = Object.values(next).filter(item => item.found).length
  const unreadCount = Object.values(next).filter(item => item.unread).length
  const missed = unreadCount ? `${unreadCount} 件没查成，其余已经对过。` : ''
  icNote.value = `案件查询对上 ${found} 件。${missed}结束的事项也会留在结果里。`
}

function onLimitResult(payload: { items: LimitMonitorRow[]; gates: Record<string, 'open' | 'pending' | 'done'>; checking: boolean; message: string }): void {
  const seen = new Set<string>()
  for (const item of payload.items) {
    const key = icKey(item.caseVolume, item.ctrlProc)
    seen.add(key)
    const gate = payload.gates[item.procId]
    const review = gate === 'pending' ? '已提交审核' : gate === 'open' || gate === 'done' ? '还没提交审核' : payload.checking ? '…' : ''
    if (limitByKey[key] !== review) limitByKey[key] = review
  }
  if (!payload.checking) {
    for (const key of Object.keys(limitByKey)) {
      if (!seen.has(key)) delete limitByKey[key]
    }
  }
  if (payload.message) limitNote.value = payload.message
  if (payload.checking) {
    limitPhase.value = 'run'
    return
  }
  const failed = !payload.items.length && /失败|尚未连接|登录|中断|意外|还不能/.test(payload.message)
  limitPhase.value = failed ? 'fail' : 'done'
}

function addresses(group: PctTaskRow[], field: 'to' | 'cc'): string {
  return [...new Set(group.map(row => {
    if (field === 'to') return (row.mailTo || sheetRecipientNames(row, specials.value, recipientMode.value).to).trim()
    return (row.mailCc || sheetRecipientNames(row, specials.value, recipientMode.value).cc).trim()
  }).filter(Boolean))].join(';')
}

function people(group: PctTaskRow[], field: 'to' | 'cc'): string {
  const names = [...new Set(group.map(row => (field === 'to' ? shownTo(row) : shownCc(row))).filter(name => name && name !== '表格里没有'))]
  if (!names.length) return '表格里没有'
  if (names.length <= 3) return names.join('、')
  return `${names.slice(0, 3).join('、')} 等 ${names.length} 人`
}

function profileFor(name: string): CustomerQueryProfile {
  const saved = props.customers.find(item => item.enabled !== false && item.name.trim() === name.trim())
  if (saved) return saved
  const now = new Date().toISOString()
  return {
    id: 'sheet',
    name: name.trim() || '表格里的客户',
    baseTemplateId: 'sheet',
    overrides: {},
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
}

function reviewerOf(): { userId: string; name: string } | null {
  const userId = connection.value.operatorId.trim()
  const name = connection.value.displayName.trim()
  if (userId && name) return { userId, name }
  return props.rules?.defaultReviewer ?? null
}

function buildPreview(): void {
  const missing: string[] = []
  if (!rows.value.length) missing.push('先传入表格。')
  if (unmatched.value.length) missing.push('还有行没有对上发文类型，请在表格里点选。')
  if (!resolvedSender.value) missing.push('还没有发件人，请选一个。')
  if (missing.length || !resolvedSender.value) {
    previews.value = []
    cards.value = []
    status.value = missing.join('')
    return
  }
  const sender = resolvedSender.value
  const reviewer = reviewerOf()
  const groups = groupWorkflowRows('1', rows.value, specials.value, recipientMode.value)
  const built = groups.map(group => {
    const types = [...new Set(group.map(row => row.mailTypeId).filter((item): item is string => Boolean(item)))]
    const typeId = types.length === 1 ? types[0] : ''
    const typeName = types.length === 1 ? (group.find(row => row.mailTypeId === typeId)?.mailTypeLabel ?? '') : ''
    const current = profileFor(group[0]?.customerName ?? '')
    const filled = fillFromRules(current, filesOf(group), props.rules, props.operatorId, props.signatureText)
    const to = addresses(group, 'to')
    const cc = addresses(group, 'cc')
    const mail = assembleMail({
      customer: current,
      mailTypeId: typeId,
      mailTypeName: typeName,
      files: filesOf(group),
      to: to || filled.to,
      cc: cc || filled.cc,
      subject: filled.subject,
      body: filled.body,
      reviewer,
      sender
    })
    if (types.length > 1) mail.gaps.push('这几行对上了不同的发文类型，合不成一封。')
    if ((to || filled.to) && !(to || filled.to).includes('@')) mail.gaps.push('收件人还是表格里的称呼。')
    return {
      mail,
      card: {
        count: group.length,
        to: people(group, 'to'),
        cc: people(group, 'cc'),
        sender: sender.label,
        gaps: mail.gaps
      }
    }
  })
  previews.value = built.map(item => item.mail)
  cards.value = built.map(item => item.card)
  status.value = ''
}

const progressPercent = computed(() => {
  if (!progress.value.length) return 0
  const done = progress.value.filter(item => item.state === 'done').length
  const moving = progress.value.some(item => item.state === 'run' || item.state === 'stop')
  return Math.round(((done + (moving ? 0.35 : 0)) / progress.value.length) * 100)
})

async function startSheetQuery(): Promise<void> {
  const token = ++sheetQueryToken
  limitPhase.value = 'run'
  for (const key of Object.keys(limitByKey)) delete limitByKey[key]
  limitNote.value = '正在查期限监控…'
  if (!rows.value.length) return
  if (!bridge || connection.value.sessionStatus !== 'authenticated') {
    limitPhase.value = 'fail'
    limitNote.value = '还没连上 EASY，库里有没有还没查。'
    void lookupCases(token)
    return
  }
  const resolved = await ctrlForSheet()
  if (token !== sheetQueryToken) return
  const ids = resolved.id.split(',').map(item => item.trim()).filter(item => isQueryGuid(item))
  if (!ids.length) {
    limitPhase.value = 'fail'
    limitNote.value = resolved.message || '处理事项还没对上，查不了。'
    void lookupCases(token)
    return
  }
  queryProcs.value = ids.map((id, index) => ({
    id,
    volumes: joinCaseVolumes(rows.value.filter(row => row.procLabel.trim() === (resolved.names[index] ?? '')).map(row => row.ourVolume.trim()).filter(Boolean))
  }))
  queryCaseVolume.value = ''
  querySeed.value = { ctrl_proc: ids[0] ?? '' }
  if (ids.length > 1) limitNote.value = `表格里有 ${ids.length} 种处理事项，期限监控按事项分开查。`
  queryToken.value += 1
  queryOpen.value = true
  void lookupCases(token)
}

async function ctrlForSheet(): Promise<{ id: string; names: string[]; message: string }> {
  if (!bridge || connection.value.sessionStatus !== 'authenticated') {
    return { id: '', names: [], message: '还没确认当前登录的人，任务没有记下。' }
  }
  const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'picker', force: false } })
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'picker') {
    const message = response.type === MessageType.Error
      ? response.payload.message
      : response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '处理事项列表没有从原网站读到。'
    return { id: '', names: [], message }
  }
  const options = (response.payload.data.dictionaries.limitCtrlProc?.options ?? []).map(item => ({
    id: item.value,
    label: item.label,
    ...(item.parentValue ? { parentId: item.parentValue } : {})
  }))
  const matched = matchSheetCtrlProcs(rows.value.map(row => row.procLabel), options)
  if (!matched.ok) return { id: '', names: [], message: matched.message }
  return { id: matched.ids, names: matched.names, message: '' }
}

async function fillEmails(): Promise<string> {
  if (!bridge) return '客户联系人没有读到，称呼还没有补成邮箱。'
  const notes: string[] = []
  let next = rows.value.slice()
  const names = [...new Set(next.map(row => row.customerName.trim()).filter(Boolean))]
  for (const name of names) {
    const profile = props.customers.find(item => item.name.trim() === name && isQueryGuid(item.easyCustomerId ?? ''))
    if (!profile?.easyCustomerId) {
      notes.push(`「${name}」没有原网站客户编号，收件人仍用表格里的称呼。`)
      continue
    }
    const response = await bridge.request({ type: MessageType.ReadCustomerDirectory, payload: { customerId: profile.easyCustomerId } })
    if (response.type === MessageType.Error) {
      notes.push(response.payload.message)
      continue
    }
    if (response.type !== MessageType.CustomerDirectoryResult || !response.payload.ok) {
      notes.push(response.type === MessageType.CustomerDirectoryResult && !response.payload.ok ? response.payload.error.message : `「${name}」的联系人没有读到。`)
      continue
    }
    const slice = next.filter(row => row.customerName.trim() === name)
    const filled = fillSheetEmails(slice, response.payload.data.rows, specials.value, recipientMode.value)
    const byVolume = new Map(filled.rows.map(row => [row.ourVolume, row]))
    next = next.map(row => byVolume.get(row.ourVolume) ?? row)
    if (!response.payload.data.complete && response.payload.data.message) notes.push(response.payload.data.message)
    notes.push(...filled.notes)
  }
  rows.value = next
  const matched = next.filter(row => (row.mailTo ?? '').includes('@') || (row.mailCc ?? '').includes('@')).length
  return [matched ? `已为 ${matched} 行补上客户联系人里唯一的邮箱。` : '', ...notes].filter(Boolean).join('')
}

async function createAndSend(): Promise<void> {
  if (saving.value) return
  buildPreview()
  if (!rows.value.length || unmatched.value.length || !resolvedSender.value || !previews.value.length) {
    progress.value = [{ label: '核对表格', detail: status.value || '还缺表格、发文类型或发件人。', state: 'stop' }]
    return
  }
  const sheetCustomers = [...new Set(rows.value.map(row => row.customerName.trim()).filter(Boolean))]
  const checked = { label: '核对表格', detail: `${rows.value.length} 行，表格里有 ${sheetCustomers.length || 1} 个客户。`, state: 'done' as const }
  progress.value = [
    checked,
    { label: '补上客户联系人邮箱', detail: '正在读取客户资料页的联系人。', state: 'run' },
    { label: '对上处理事项', detail: '', state: 'wait' },
    { label: '在这一页查询', detail: '', state: 'wait' }
  ]
  saving.value = true
  try {
    const emailNote = await fillEmails()
    buildPreview()
    progress.value = [
      checked,
      { label: '补上客户联系人邮箱', detail: emailNote || '表格里的称呼没有需要补的邮箱。', state: 'done' },
      { label: '对上处理事项', detail: '正在从原网站读取处理事项。', state: 'run' },
      { label: '在这一页查询', detail: '', state: 'wait' }
    ]
    const resolved = await ctrlForSheet()
    if (!isQueryGuid(resolved.id)) {
      progress.value[2] = { label: '对上处理事项', detail: resolved.message || '处理事项还没对上原网站。', state: 'stop' }
      return
    }
    if (connection.value.sessionStatus !== 'authenticated') {
      progress.value[2] = { label: '对上处理事项', detail: '还没确认当前登录的人，任务没有记下。', state: 'stop' }
      return
    }
    const sender = resolvedSender.value
    const kept = confirmedProcIds.value.length ? confirmedProcIds.value : (readWorkflowTask()?.confirmedProcIds ?? [])
    const built = buildPctTask({
      rows: rows.value,
      ctrlProcId: resolved.id,
      confirmedProcIds: kept,
      ...(sender ? { sender: { mailsetId: sender.mailsetId, label: sender.label } } : {}),
      createdAt: new Date().toISOString(),
      workflowId: workflowId.value,
      recipientMode: recipientMode.value
    })
    if (!built.ok) {
      progress.value[2] = { label: '对上处理事项', detail: built.message, state: 'stop' }
      return
    }
    const volumes = volumesOf(rows.value)
    const caseVolume = joinCaseVolumes(volumes)
    writeWorkflowTask(built.task)
    sessionStorage.removeItem(PENDING_CUSTOMER_KEY)
    sessionStorage.removeItem(PCT_RESUME_KEY)
    sheetQueryToken += 1
    const fields: Record<string, string> = { ctrl_proc: resolved.id }
    if (caseVolume.length <= 4000) fields.case_volume = caseVolume
    queryCaseVolume.value = caseVolume
    querySeed.value = fields
    queryToken.value += 1
    queryOpen.value = true
    progress.value[2] = { label: '对上处理事项', detail: '处理事项已经对上。', state: 'done' }
    progress.value[3] = {
      label: '在这一页查询',
      detail: `${summarizePctTask(built.task)}查询表已经展开在下面。创建邮件和提交还没核对完响应，这一步没有发出去。`,
      state: 'done'
    }
  } finally {
    saving.value = false
  }
}

function onSheetConfirm(procIds: string[]): void {
  confirmedProcIds.value = procIds
  const stored = readWorkflowTask()
  const ctrl = stored?.ctrlProcId || querySeed.value?.ctrl_proc || ''
  const sender = resolvedSender.value
  const built = rows.value.length && isQueryGuid(ctrl)
    ? buildPctTask({
      rows: rows.value,
      ctrlProcId: ctrl,
      confirmedProcIds: procIds,
      ...(sender ? { sender: { mailsetId: sender.mailsetId, label: sender.label } } : {}),
      createdAt: stored?.createdAt || new Date().toISOString(),
      workflowId: workflowId.value,
      recipientMode: recipientMode.value
    })
    : null
  const task = built?.ok ? built.task : stored ? clonePctTask({ ...stored, confirmedProcIds: procIds }) : null
  if (task) writeWorkflowTask(task)
  const step = progress.value[3]
  if (step && task) {
    progress.value[3] = {
      ...step,
      detail: `${summarizePctTask(task)}查询表已经展开在下面。再点「提交到 EASY」会创建发文并交给当前登录人。`
    }
  }
  void rememberConfirmed(procIds)
}

async function rememberConfirmed(procIds: string[]): Promise<void> {
  const scope = scopeFromConnection(connection.value)
  if (!scope) return
  const names = new Set(rows.value.map(row => row.customerName.trim()).filter(Boolean))
  const withTask = props.customers.filter(item => item.pctTask)
  const named = withTask.filter(item => names.has(item.name))
  const targets = named.length ? named : withTask.length === 1 ? withTask : []
  for (const customer of targets) {
    if (!customer.pctTask) continue
    await call({
      action: 'saveCustomer',
      profile: JSON.parse(JSON.stringify({
        ...customer,
        pctTask: clonePctTask({ ...customer.pctTask, confirmedProcIds: procIds }),
        updatedAt: new Date().toISOString()
      })),
      expectedScope: scope,
      expectedRevision: customer.revision ?? 1
    })
  }
}

async function onRefreshStatus(payload: { targets: Array<{ caseVolume: string; procLabel: string }>; abnormal: Array<{ caseVolume: string; procLabel: string }> }): Promise<void> {
  abnormalKeys.value = new Set(payload.abnormal.map(item => icKey(item.caseVolume, item.procLabel)))
  const unique = payload.targets.filter(item => item.caseVolume.trim() && item.procLabel.trim())
  try {
    if (!bridge || connection.value.sessionStatus !== 'authenticated') {
      logProgress('还没连上 EASY，案件状态没有回传。')
      return
    }
    if (!unique.length) {
      logProgress('没有对上要回传的文号。')
      return
    }
    logProgress(`正在用案件查询回传 ${unique.length} 件。`)
    const response = await bridge.request({
      type: MessageType.LookupIcFlow,
      payload: { rows: unique.slice(0, IC_LOOKUP_WIDTH).map(item => ({ caseVolume: item.caseVolume.trim(), procLabel: item.procLabel.trim() })) }
    })
    if (response.type !== MessageType.LookupIcFlowResult || !response.payload.ok) {
      const message = response.type === MessageType.LookupIcFlowResult && !response.payload.ok
        ? response.payload.error.message
        : response.type === MessageType.Error
          ? response.payload.message
          : '案件状态没有回传。'
      logProgress(message)
      return
    }
    for (const item of response.payload.data.items) {
      const key = icKey(item.caseVolume, item.procLabel)
      if (item.unread) icByKey[key] = { found: false, gate: '', unread: true }
      else if (item.statusUnread) icByKey[key] = { found: true, gate: '', statusUnread: true }
      else icByKey[key] = { found: item.found, gate: item.gate }
    }
    if (icPhase.value === 'idle') icPhase.value = 'done'
    for (const item of unique) {
      const row = rows.value.find(entry => volumeKey(entry.ourVolume) === volumeKey(item.caseVolume) && entry.procLabel.trim() === item.procLabel.trim())
      const status = row ? sheetStatus(row) : { found: '', review: '' }
      logProgress(`${item.caseVolume}：${status.review || status.found || '没对上'}`)
    }
  } finally {
    logProgress(progressSummaryLine())
    endProgress()
  }
}

const missedCount = computed(() => rows.value.filter(row => {
  const found = sheetStatus(row).found
  return found === '库里没有' || found === '没查成'
}).length)

function exportMissed(): void {
  const sheets = missedSourceSheets(rows.value, row => sheetStatus(row).found, runtime.value.columns)
  if (!sheets.length) return
  const count = sheets.reduce((sum, sheet) => sum + sheet.rows.length - 1, 0)
  downloadXlsxSheets(sheets, `查不到的文号-${count}行.xlsx`)
}

async function askGaps(): Promise<void> {
  const waves = gapWaves.value.filter(item => item.trim())
  if (!waves.length || askingGap.value) return
  askingGap.value = true
  window.dispatchEvent(new CustomEvent('patmail-arbitrate', { detail: waves }))
  askingGap.value = false
}

function definitionHint(item: WorkflowDefinition | null): string {
  if (!item || isRunnableWorkflow(item) || item.id === FILE_MANAGE_ID) return ''
  return '这条还缺读取表格、对收件人和提交审核要用的步骤，现在还不能按它生成预览。'
}
</script>

<template>
  <section class="card">
    <div class="card-head"><h2>按工作流发文</h2></div>
    <p v-if="workflowId === FILE_MANAGE_ID" class="hint">选择已经绑好文件管理的客户。按这位客户保存的查询条件和发文方式查出文件。文件描述按发文映射对上发文类型。收件人是案件联系人，抄送是默认发件人和商务，审核人是默认审核人，标题用标题模板，正文用发文页邮件签名下拉里的格式。所属部门包含研发本部时，在文件描述右侧写入全部发明人，顿号分隔。</p>
    <p v-else class="hint">一次读「提醒申请PCT」和「PCT进国家」两张表。进国家有我方文号就用我方案号，没有再用贵方。外观用涉外外观那一种。同一客户里连续空着的 IPR 沿用上一行。完全空着的，按处理细节摘一句，也可以交给助手去案件要求里仲裁。邮箱那一列不读。</p>
    <div class="form-grid">
      <div v-if="workflowOptions.length === 0" class="span-all">
        <EmptyGuide text="还没有工作流。去工作流里看 PCT提醒。" action="去工作流" hash="/workflow" />
      </div>
      <label v-else>工作流
        <ThemeSelect v-model="workflowId" placeholder="选择工作流" :options="workflowOptions" />
      </label>
    </div>
    <p v-if="definitionHint(definition)" class="hint">{{ definitionHint(definition) }}</p>

    <FileManageMail v-if="workflowId === FILE_MANAGE_ID" :customers="customers" :rules="rules" :senders="senders" />
    <template v-else-if="runnable">
      <div class="form-grid">
        <label v-if="senderMissing">发件人 <span class="need-mark">必填</span>
          <ThemeSelect :model-value="senderId" placeholder="选择发件邮箱" empty-text="发件邮箱还没读到。先确认已经连上，再重新打开这一页。" :options="senderOptions" @update:model-value="chooseSender(String($event))" />
        </label>
        <label>表格 <span class="need-mark">必填</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onSheet" />
        </label>
      </div>
      <p v-for="note in styleNotes" :key="note" class="hint">这张表按同一客户、同一收件人和抄送合成一封。{{ note }}</p>
      <p v-if="sheetName" class="hint">{{ sheetName }}{{ sheetNotice ? `。${sheetNotice}` : '' }}</p>
      <button v-if="gapWaves.length" type="button" class="ghost" :disabled="askingGap" @click="askGaps">交给助手仲裁空着的 IPR{{ gapWaves.length > 1 ? `（分 ${gapWaves.length} 批）` : '' }}</button>
      <button v-if="missedCount" type="button" class="ghost" @click="exportMissed">导出查不到的 {{ missedCount }} 行</button>
      <p v-if="mailTypes.length === 0" class="hint">发文类型还没读到。确认已经连上后，重新打开这一页。</p>
      <p v-if="unmatched.length" class="hint">这 {{ unmatched.length }} 行没有对上发文类型，请点选。</p>
      <p v-if="offCount" class="hint">有 {{ offCount }} 行的处理事项不是「{{ runtime.procLabel }}」。</p>
      <p class="hint">上面是期限监控，只列出还没结束的事项。表格里的文号另外走案件查询，结束的事项也能对上。</p>
      <LimitMonitorQuery
        :bridge="bridge"
        :user-id="connection.operatorId"
        :connected="connection.sessionStatus === 'authenticated'"
        :seed="querySeed"
        :proc-queries="queryProcs"
        :seed-token="queryToken"
        :case-volume="queryCaseVolume"
        :sheet-rows="rows"
        :recipient-mode="recipientMode"
        :inventor-customers="inventorCustomers"
        @result="onLimitResult"
        @confirm="onSheetConfirm"
        @refresh-status="onRefreshStatus"
      />
      <p v-if="icPhase === 'fail'" class="error" role="alert">{{ icNote || '案件查询没有完成。' }} 已经出现在上面的行，先用上面的流程状态。</p>
      <p v-else-if="icNote" class="hint">{{ icNote }}</p>
      <p v-if="limitNote" class="hint">{{ limitNote }}</p>
      <div v-if="rows.length" class="toolbar">
        <span>共 {{ rows.length }} 行</span>
        <div v-if="sheetPages > 1" class="pagination">
          <button class="ghost tiny" type="button" :disabled="sheetPageSafe <= 1" @click="setSheetPage(sheetPageSafe - 1)">上一页</button>
          <span>{{ sheetPageSafe }} / {{ sheetPages }}</span>
          <button class="ghost tiny" type="button" :disabled="sheetPageSafe >= sheetPages" @click="setSheetPage(sheetPageSafe + 1)">下一页</button>
        </div>
      </div>
      <table v-for="n in sheetSeen" v-show="n === sheetPageSafe && rows.length" :key="n" class="grid">
        <thead><tr><th>我方文号</th><th>客户</th><th>客户文号</th><th>处理事项</th><th>发文类型</th><th>收件人</th><th>抄送</th><th>查询结果</th><th>审核状态</th></tr></thead>
        <tbody>
          <tr v-for="row in rowsOnSheetPage(n)" :key="row.ourVolume + '\n' + row.procLabel" v-memo="[row, sheetMemo(row)]">
            <td>{{ row.ourVolume }}</td>
            <td>{{ row.customerName || '表格里没有' }}</td>
            <td>{{ row.customerVolume || '无' }}</td>
            <td>{{ row.procLabel }}</td>
            <td>
              <span v-if="row.mailTypeId">{{ row.mailTypeLabel }}</span>
              <MailTypeTreeSelect v-else :model-value="row.mailTypeId ?? ''" :options="mailTypeOptions" :disabled="mailTypes.length === 0" @update:model-value="setRowType(row.ourVolume, String($event))" />
            </td>
            <td>
              <div>{{ shownTo(row) }}</div>
              <div v-if="carriedContactNote(row)">{{ carriedContactNote(row) }}</div>
            </td>
            <td>{{ shownCc(row) }}</td>
            <td :class="statusShade(sheetStatus(row).found)">{{ sheetStatus(row).found }}</td>
            <td :class="statusShade(sheetStatus(row).review)">{{ sheetStatus(row).review }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="status" class="save-status" role="status">{{ status }}</p>
      <section v-if="cards.length" class="card inset">
        <h2>{{ outcome }}</h2>
        <p v-if="outcomeGroups.length" class="hint">{{ outcomeGroups.join('，') }}。</p>
        <p class="hint">上面已经按表格查过。库里没有和没查成的可以按源表导出。重新查询会再查一次，并补上客户联系人里唯一的邮箱。</p>
        <button v-if="missedCount" type="button" class="ghost" @click="exportMissed">导出查不到的 {{ missedCount }} 行</button>
        <button type="button" class="solid" :disabled="saving" @click="createAndSend">{{ saving ? '正在准备查询…' : '重新查询' }}</button>
        <div v-if="progress.length" class="send-progress" role="status">
          <div class="send-bar" aria-hidden="true"><span :style="{ width: progressPercent + '%' }"></span></div>
          <ol>
            <li v-for="step in progress" :key="step.label" :class="'is-' + step.state">
              <strong>{{ step.label }}</strong>
              <span>{{ step.detail }}</span>
            </li>
          </ol>
        </div>
      </section>
    </template>
  </section>
</template>
