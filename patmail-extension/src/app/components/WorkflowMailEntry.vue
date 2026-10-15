<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import MailTypeTreeSelect from '../../shell/components/MailTypeTreeSelect.vue'
import ThemeSelect from '../../shell/components/ThemeSelect.vue'
import EmptyGuide from './EmptyGuide.vue'
import LimitMonitorQuery from './LimitMonitorQuery.vue'
import type { MailSender } from '../../customer/mailset'
import { PCT_RESUME_KEY, PENDING_CUSTOMER_KEY } from '../../customer/mail-flow'
import { fillSheetEmails } from '../../customer/customer-page'
import { IC_LOOKUP_WIDTH } from '../../customer/ic-flow-lookup'
import { MAILED_UNFINISHED_REVIEW, SKIP_SEND_REVIEW, reviewNeedsArbitration, type IcFlowHit } from '../../customer/pct-flow-status'
import { paintTaskCheckProgress, resetTaskCheckProgress, sessionInterrupted } from '../check-progress'
import { applyArbitrationReply, arbitrationAllowed, checkedSourceSheets, iprArbitrationWaves, isPctWorkbookSheet, missedSourceSheets, pctRowsFromWorkbook, shouldAutoArbitrate, type ArbitrationDecision } from '../../customer/pct-workbook'
import { applyPctMailTypes, buildPctTask, clonePctTask, matchSheetCtrlProcs, PCT_WORKFLOW_TASK_KEY, procGapNotes, readWorkflowTask, recarryCustomerContacts, summarizePctTask, volumesOf, writeWorkflowTask } from '../../customer/pct-sheet'
import type { CustomerQueryProfile, PctTaskRow } from '../../customer/types'
import { arbitratedMark, carriedMark, sheetDisplayName, sheetRecipientNames, usesInventorSheet } from '../../customer/pct-recipients'
import { inventorCustomerNames, isRunnableWorkflow, recipientModeOf } from '../../workflow/catalog'
import { downloadXlsxSheets, readXlsxSheets } from '../../customer/xlsx-table'
import { assembleMail, fillFromRules } from '../../mail'
import type { AssembledMail } from '../../mail/assemble'
import type { MailRuleBundle, SelectedPatentFile } from '../../mail/types'
import { joinCaseVolumes } from '../../customer/volume-list'
import type { LimitMonitorRow } from '../../api/limit-monitor-types'
import { isQueryGuid } from '../../query/query-validator'
import { flushRecovery, holdRecovery, peekRecovery, recallRecovery, scheduleRecovery, systemScope } from '../../recovery/wal-ledger'
import { assignColumnWidths } from '../../shell/column-fit'
import { MessageType, type MessageBridge } from '../../shared/message'
import { sceneOwnerChanged, scopeFromConnection } from '../../shared/connection'
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
type IcHit = { found: boolean; gate: '' | 'open' | 'pending' | 'done'; uncontrolled?: true; skipSend?: true; unread?: true; statusUnread?: true }
type FlowAsk = { caseVolume: string; procLabel: string; customerVolume?: string; withRecord?: true }
let icHits: Record<string, IcHit> = Object.create(null)
let recordByVolume: Record<string, { customer: string; record: string }> = Object.create(null)
const icEpoch = ref(0)
const PUBLISH_MS = 800
let publishTimer = 0
const limitByKey = reactive<Record<string, string>>({})
const gapWaves = ref<string[]>([])
const sheetPage = ref(1)
const AUTO_ARBITRATE_KEY = 'patmail.autoArbitrate.v1'
const ALLOW_MAILED_UNFINISHED_KEY = 'patmail.allowMailedUnfinished.v1'
const ARBITRATE_IPR_ONLY_KEY = 'patmail.arbitrateIprOnly.v1'
const CARRY_ACROSS_BREAKS_KEY = 'patmail.carryAcrossBreaks.v1'
const askingGap = ref(false)
const autoArbitrate = ref(true)
/** 「已发文，事项未管制完成日」的行默认允许提交，提交前会弹警示框列出这些行。 */
const allowMailedUnfinished = ref(true)
/** 客户要求没写发给谁时，仲裁是否允许把技术联系人写成收件人。默认关：这类行留空，交给「全选联系人」。 */
const arbitrateIprOnly = ref(false)
/** 空着的联系人是否跨行顺延。默认只在同一客户连成整块时补；勾上后中间隔了别的客户也照补。 */
const carryAcrossBreaks = ref(false)
const arbitrationReady = computed(() => arbitrationAllowed(icPhase.value))
const arbitrationHint = computed(() => arbitrationReady.value
  ? '用核对时暂存的客户要求和著录项目仲裁。已经提交、审核通过的行不交；未管制完成日的行跟着「已发文未管制的行允许发文」开关。若还有没查成的，先把这些行重新查一遍，查完再交给仲裁。已经查成的行不再查。'
  : '核对还没结束。客户要求和著录项目是跟着核对带回来的，齐了才能仲裁。')
const arbitrationOpen = ref(false)
const arbitrationBoard = ref<Array<ArbitrationDecision & { customer: string }>>([])
/** 这两个值只在核对前有意义，核对开始就固定。仲裁写回过的表格也不许再改，避免和已有结论冲突。 */
const optionLocked = computed(() => icPhase.value !== 'idle' || rows.value.some(row => row.iprArbitrated))
/** 允不允许未管制行发文会改变这轮核对和仲裁的范围，核对中、仲裁中锁定，结束后到发文阶段才许改。 */
const mailToggleLocked = computed(() => icPhase.value === 'run' || askingGap.value)
const abnormalKeys = ref(new Set<string>())
const confirmedProcIds = ref<string[]>([])
let sheetQueryToken = 0
let sheetImportToken = 0
let liveAsked: Array<FlowAsk & { tries: number }> | null = null
let liveMeter: { total: number; startedAt: number; finished: Set<string> } | null = null
let holdCheck = false
let holdLimit = false
let resumingCheck = false
let holdSpin = 0
let holdTimer = 0
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
    return [`「${name}」在客户管理里保存的发文方式是${label ? `「${label}」` : '另一种'}。提交仍按勾选逐件单个来文，不会按那种方式把没勾的并进来。`]
  })
})
const procGaps = computed(() => procGapNotes(rows.value, runtime.value.procLabel))
const outcomePack = computed(() => {
  const empty = { text: '', bars: [] as Array<{ key: string; label: string; count: number; color: string; percent: number }> }
  if (!rows.value.length) return empty
  let pending = 0
  let submitted = 0
  let mailed = 0
  let done = 0
  let missing = 0
  let unread = 0
  let noProc = 0
  let statusMiss = 0
  let checking = 0
  let abnormal = 0
  let skipped = 0
  for (const row of rows.value) {
    const status = sheetStatus(row)
    if (status.review === '异常') abnormal += 1
    else if (status.found === '库里没有') missing += 1
    else if (status.found === '没查成') unread += 1
    else if (status.found === '正在查' || status.review === '…') checking += 1
    else if (status.review === '还没提交审核') pending += 1
    else if (status.review === '已提交审核') submitted += 1
    else if (status.review === MAILED_UNFINISHED_REVIEW) mailed += 1
    else if (status.review === SKIP_SEND_REVIEW) skipped += 1
    else if (status.review === '已经审核通过') done += 1
    else if (status.review === '没有这项处理事项') noProc += 1
    else if (status.review === '状态没读到') statusMiss += 1
    else if (icPhase.value === 'run') checking += 1
    else missing += 1
  }
  const text = [
    pending ? `还有 ${pending} 行待处理。提交时只发勾上的，一件一封。` : '没有待处理的行。',
    submitted ? `已提交审核 ${submitted} 行。` : '',
    mailed ? `${MAILED_UNFINISHED_REVIEW} ${mailed} 行。` : '',
    skipped ? `${SKIP_SEND_REVIEW} ${skipped} 行。` : '',
    done ? `已经审核通过 ${done} 行。` : '',
    missing ? `库里没有 ${missing} 行。` : '',
    unread ? `没查成 ${unread} 行。` : '',
    noProc ? `没有这项处理事项 ${noProc} 行。` : '',
    statusMiss ? `状态没读到 ${statusMiss} 行。` : '',
    abnormal ? `异常 ${abnormal} 行。` : '',
    checking ? `还有 ${checking} 行正在核对。` : ''
  ].filter(Boolean).join('')
  const bars = [
    { key: 'pending', label: '待处理', count: pending, color: '#1d4ed8' },
    { key: 'submitted', label: '已提交审核', count: submitted, color: '#9a6700' },
    { key: 'mailed', label: MAILED_UNFINISHED_REVIEW, count: mailed, color: '#3e5670' },
    { key: 'skipped', label: SKIP_SEND_REVIEW, count: skipped, color: '#7a3e86' },
    { key: 'done', label: '已经审核通过', count: done, color: '#157a45' },
    { key: 'missing', label: '库里没有', count: missing, color: '#c4234e' },
    { key: 'unread', label: '没查成', count: unread, color: '#c4234e' },
    { key: 'noProc', label: '没有这项处理事项', count: noProc, color: '#8b95a8' },
    { key: 'statusMiss', label: '状态没读到', count: statusMiss, color: '#8b95a8' },
    { key: 'abnormal', label: '异常', count: abnormal, color: '#9a6700' },
    { key: 'checking', label: '正在核对', count: checking, color: '#b7c0d2' }
  ].filter(item => item.count > 0)
  const widest = Math.max(...bars.map(item => item.count), 1)
  return {
    text,
    bars: bars.map(item => ({ ...item, percent: Math.max(2, Math.round(item.count / widest * 1000) / 10) }))
  }
})
const outcome = computed(() => outcomePack.value.text)
const outcomeBars = computed(() => outcomePack.value.bars)

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

const sheetHost = ref<HTMLElement | null>(null)
const sheetColWidths = ref<number[]>([])
const sheetTableStyle = computed(() => {
  const total = sheetColWidths.value.reduce((sum, width) => sum + width, 0)
  if (!total) return undefined
  return { width: `${total}px`, minWidth: '100%' }
})
let sheetRuler: HTMLSpanElement | null = null
let sheetObserver: ResizeObserver | null = null
let sheetObserved: HTMLElement | null = null

function sheetTextWidth(text: string, source: Element): number {
  if (!sheetRuler) return 0
  sheetRuler.style.font = getComputedStyle(source).font
  sheetRuler.textContent = text
  return Math.ceil(sheetRuler.offsetWidth) + 2
}

function layoutSheet(): void {
  const root = sheetHost.value
  if (!root || !sheetRuler) return
  if (sheetObserved !== root) {
    if (sheetObserved) sheetObserver?.unobserve(sheetObserved)
    sheetObserver?.observe(root)
    sheetObserved = root
  }
  const pageRows = rowsOnSheetPage(sheetPageSafe.value)
  if (!pageRows.length) {
    sheetColWidths.value = []
    return
  }
  const container = root.clientWidth
  if (container <= 0) return
  const table = root.querySelector('table')
  if (!table) return
  const header = table.querySelector('thead th') || table
  const cell = table.querySelector('tbody td') || header
  const pad = 16
  const minOf = (title: string) => sheetTextWidth(title, header) + pad
  const widest = (title: string, values: string[]) => {
    let content = minOf(title)
    for (const value of values) content = Math.max(content, sheetTextWidth(value, cell) + pad)
    return { min: minOf(title), content }
  }
  const volume = widest('我方文号', pageRows.map(row => row.ourVolume))
  const customer = widest('客户', pageRows.map(row => row.customerName || '表格里没有'))
  const customerVolume = widest('客户文号', pageRows.map(row => row.customerVolume || '无'))
  const proc = widest('处理事项', pageRows.map(row => row.procLabel))
  const typeMin = minOf('发文类型')
  let typeContent = typeMin
  for (const row of pageRows) {
    const label = row.mailTypeId ? (row.mailTypeLabel || '') : '选择发文类型'
    let width = sheetTextWidth(label, row.mailTypeId ? cell : header) + pad
    if (!row.mailTypeId) width += 22
    typeContent = Math.max(typeContent, width)
  }
  const to = widest('收件人', pageRows.flatMap(row => [shownTo(row), carriedContactNote(row)].filter(Boolean)))
  const cc = widest('抄送', pageRows.map(row => shownCc(row)))
  const found = widest('查询结果', pageRows.map(row => sheetStatus(row).found))
  const review = widest('审核状态', pageRows.map(row => sheetStatus(row).review))
  sheetColWidths.value = assignColumnWidths([
    volume,
    { ...customer, grow: true },
    customerVolume,
    proc,
    { min: typeMin, content: typeContent },
    { ...to, grow: true },
    cc,
    found,
    { ...review, lock: true }
  ], container)
}

const sheetMeasureKey = computed(() => rowsOnSheetPage(sheetPageSafe.value).map(row => [
  row.ourVolume, row.customerName, row.customerVolume, row.procLabel, row.mailTypeId ?? '', row.mailTypeLabel,
  shownTo(row), carriedContactNote(row), shownCc(row), sheetStatus(row).found, sheetStatus(row).review
].join('\u0001')).join('\u0002'))

watch(sheetMeasureKey, () => layoutSheet(), { flush: 'post' })

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
  arbitrationBoard.value = []
  arbitrationOpen.value = false
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
    const parsed = pctRowsFromWorkbook(await readXlsxSheets(await file.arrayBuffer(), isPctWorkbookSheet), props.mailTypes, runtime.value, carryAcrossBreaks.value ? 'cross' : 'block')
    if (generation !== sheetImportToken) return
    rows.value = applyPctMailTypes(parsed.rows, props.mailTypes, runtime.value)
    resetSheetPages()
    gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
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

watch(() => [props.mailTypes, runtime.value] as const, () => {
  if (!rows.value.length || !props.mailTypes.length || !rows.value.some(row => !row.mailTypeId)) return
  const next = rows.value.map(row => {
    if (row.mailTypeId) return row
    return applyPctMailTypes([row], props.mailTypes, runtime.value)[0] ?? row
  })
  if (next.every((row, index) => row.mailTypeId === rows.value[index]?.mailTypeId)) return
  rows.value = next
  buildPreview()
})

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
  if (row.iprArbitrated && row.iprName.trim() && recipientMode.value !== 'lead') return arbitratedMark(row.iprName, true)
  if (recipientMode.value === 'lead') return carriedMark(sheetDisplayName(row.leadName ?? ''), row.leadCarried) || '表格里没有'
  const inventor = usesInventorSheet(row.customerName, specials.value)
  const marked = carriedMark(inventor ? row.contactName : row.iprName, inventor ? row.contactCarried : row.iprCarried)
  return marked || '表格里没有'
}

function shownCc(row: PctTaskRow): string {
  const written = row.mailCc?.trim() ?? ''
  if (recipientMode.value === 'lead') {
    const ipr = row.iprArbitrated ? arbitratedMark(row.iprName, true) : carriedMark(row.iprName, row.iprCarried)
    const base = ipr ? `${ipr}、商务` : '商务'
    if (!written) return base
    return written.includes('商务') ? written : `${written}、${base}`
  }
  if (row.iprArbitrated || !usesInventorSheet(row.customerName, specials.value)) {
    if (!written || written === '商务') return '商务'
    return written.includes('商务') ? written : `${written}、商务`
  }
  return written || carriedMark(row.iprName, row.iprCarried) || '表格里没有'
}

function carriedContactNote(row: PctTaskRow): string {
  if (!row.contactCarried || usesInventorSheet(row.customerName, specials.value)) return ''
  const marked = carriedMark(row.contactName, true)
  return marked ? `第一客户联系人 ${marked}` : ''
}

function releasePublish(): void {
  if (!publishTimer) return
  window.clearTimeout(publishTimer)
  publishTimer = 0
}

function clearHits(): void {
  releasePublish()
  icHits = Object.create(null)
  recordByVolume = Object.create(null)
  icEpoch.value += 1
  for (const key of Object.keys(limitByKey)) delete limitByKey[key]
}

function blankDesk(): void {
  sheetImportToken += 1
  saving.value = false
  sheetName.value = ''
  sheetNotice.value = ''
  rows.value = []
  gapWaves.value = []
  askingGap.value = false
  arbitrationOpen.value = false
  arbitrationBoard.value = []
  abnormalKeys.value = new Set()
  confirmedProcIds.value = []
  previews.value = []
  cards.value = []
  progress.value = []
  status.value = ''
  senderTouched.value = false
  resetLimit()
  try { sessionStorage.removeItem(PCT_WORKFLOW_TASK_KEY) } catch { /* 当前页面没有会话存储时略过 */ }
}

let deskOwner = ''
let parking = false

function scopeOf(origin: string, operator: string): string {
  const id = operator.trim()
  const who = isQueryGuid(id) ? id.toLowerCase() : 'local'
  return systemScope(origin, who)
}

function deskScope(): string {
  return scopeOf(connection.value.easyOrigin, deskOwner || props.operatorId || connection.value.operatorId)
}

watch(() => `${connection.value.easyOrigin}\n${connection.value.operatorId}`, (next, previous) => {
  if (!previous || next === previous) return
  const splitAt = previous.indexOf('\n')
  const prevOrigin = splitAt < 0 ? previous : previous.slice(0, splitAt)
  const prevOperator = splitAt < 0 ? '' : previous.slice(splitAt + 1)
  const originChanged = prevOrigin !== connection.value.easyOrigin
  const sceneOwner = deskOwner || (isQueryGuid(prevOperator) ? prevOperator : '')
  const operatorChanged = sceneOwnerChanged(sceneOwner, connection.value.operatorId)
  if (!originChanged && !operatorChanged) {
    if (isQueryGuid(connection.value.operatorId)) {
      const hadOwner = Boolean(deskOwner)
      deskOwner = connection.value.operatorId.toLowerCase()
      if (!hadOwner && !rows.value.length) {
        const arriving = deskScope()
        void recallRecovery('workflow-desk', arriving).then(saved => {
          if (deskScope() !== arriving || rows.value.length) return
          applyDesk(saved)
          pokeDesk()
        }).catch(() => { /* 这个账号还没有账本 */ })
      }
    }
    return
  }
  parking = true
  const payload = readDesk()
  holdRecovery('workflow-desk', scopeOf(prevOrigin, deskOwner || prevOperator), payload)
  blankDesk()
  deskOwner = isQueryGuid(connection.value.operatorId) ? connection.value.operatorId.toLowerCase() : ''
  const arriving = deskScope()
  const cached = peekRecovery('workflow-desk', arriving)
  if (cached) applyDesk(cached)
  parking = false
  pokeDesk()
  if (cached === undefined) {
    void recallRecovery('workflow-desk', arriving).then(saved => {
      if (deskScope() !== arriving || rows.value.length) return
      applyDesk(saved)
      pokeDesk()
    }).catch(() => { /* 这个系统还没有账本 */ })
  }
})

function phaseOf(value: unknown): 'idle' | 'run' | 'done' | 'fail' {
  return value === 'run' || value === 'done' || value === 'fail' || value === 'idle' ? value : 'idle'
}

function readDesk(): unknown | null {
  const idle = !rows.value.length && icPhase.value === 'idle' && limitPhase.value === 'idle' && !progress.value.length && !arbitrationBoard.value.length && !confirmedProcIds.value.length
  if (idle) return null
  const owner = props.operatorId || connection.value.operatorId || deskOwner
  return {
    version: 1,
    operatorId: isQueryGuid(owner) ? owner.toLowerCase() : '',
    origin: connection.value.easyOrigin,
    workflowId: workflowId.value,
    sheetName: sheetName.value,
    sheetNotice: sheetNotice.value,
    rows: rows.value,
    senderId: senderId.value,
    status: status.value,
    progress: progress.value,
    limitPhase: limitPhase.value,
    limitNote: limitNote.value,
    icPhase: icPhase.value,
    icNote: icNote.value,
    icHits,
    recordByVolume,
    limitByKey: { ...limitByKey },
    arbitrationBoard: arbitrationBoard.value,
    confirmedProcIds: confirmedProcIds.value,
    abnormalKeys: [...abnormalKeys.value],
    queryOpen: queryOpen.value,
    querySeed: querySeed.value,
    queryProcs: queryProcs.value,
    queryCaseVolume: queryCaseVolume.value
  }
}

function applyDesk(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || rows.value.length) return
  const desk = payload as Record<string, unknown>
  if (desk.version !== 1 || !Array.isArray(desk.rows)) return
  const owner = typeof desk.operatorId === 'string' ? desk.operatorId.toLowerCase() : ''
  const live = props.operatorId || connection.value.operatorId
  if (isQueryGuid(live) && owner && live.toLowerCase() !== owner) return
  const next = desk.rows.filter((row): row is PctTaskRow => Boolean(row) && typeof row === 'object' && typeof (row as PctTaskRow).ourVolume === 'string')
  if (!next.length && !Array.isArray(desk.progress)) return
  if (typeof desk.workflowId === 'string') workflowId.value = desk.workflowId
  if (typeof desk.sheetName === 'string') sheetName.value = desk.sheetName
  if (typeof desk.senderId === 'string') senderId.value = desk.senderId
  if (typeof desk.status === 'string') status.value = desk.status
  rows.value = next
  const ic = phaseOf(desk.icPhase)
  const icNoteText = typeof desk.icNote === 'string' ? desk.icNote : ''
  holdCheck = ic === 'run' || (ic === 'fail' && sessionInterrupted(icNoteText))
  icPhase.value = holdCheck ? 'run' : ic
  icNote.value = holdCheck ? '登录中断时核对还在进行。同一位登录人接回后会接着查剩下的。' : icNoteText
  const limit = phaseOf(desk.limitPhase)
  const limitNoteText = typeof desk.limitNote === 'string' ? desk.limitNote : ''
  holdLimit = limit === 'run' || (limit === 'fail' && sessionInterrupted(limitNoteText))
  limitPhase.value = holdLimit ? 'run' : limit
  limitNote.value = holdLimit ? '登录中断时查询还在进行。同一位登录人接回后会接着查。' : limitNoteText
  progress.value = Array.isArray(desk.progress)
    ? desk.progress.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const step = item as { label?: unknown; detail?: unknown; state?: unknown }
      const state = step.state === 'wait' || step.state === 'run' || step.state === 'done' || step.state === 'stop' ? step.state : 'stop'
      return [{
        label: typeof step.label === 'string' ? step.label : '发文',
        detail: state === 'run' ? '登录中断，这一步停住了。已经完成的还在。' : (typeof step.detail === 'string' ? step.detail : ''),
        state: state === 'run' ? 'stop' as const : state
      }]
    })
    : []
  if (desk.icHits && typeof desk.icHits === 'object') icHits = desk.icHits as Record<string, IcHit>
  if (desk.recordByVolume && typeof desk.recordByVolume === 'object') recordByVolume = desk.recordByVolume as Record<string, { customer: string; record: string }>
  for (const key of Object.keys(limitByKey)) delete limitByKey[key]
  if (desk.limitByKey && typeof desk.limitByKey === 'object') Object.assign(limitByKey, desk.limitByKey)
  arbitrationBoard.value = Array.isArray(desk.arbitrationBoard) ? desk.arbitrationBoard as Array<ArbitrationDecision & { customer: string }> : []
  confirmedProcIds.value = Array.isArray(desk.confirmedProcIds) ? desk.confirmedProcIds.filter((item): item is string => typeof item === 'string') : []
  abnormalKeys.value = new Set(Array.isArray(desk.abnormalKeys) ? desk.abnormalKeys.filter((item): item is string => typeof item === 'string') : [])
  queryOpen.value = desk.queryOpen === true
  querySeed.value = desk.querySeed && typeof desk.querySeed === 'object' ? desk.querySeed as Record<string, string> : null
  queryProcs.value = Array.isArray(desk.queryProcs) ? desk.queryProcs.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const proc = item as { id?: unknown; volumes?: unknown }
    return typeof proc.id === 'string' && typeof proc.volumes === 'string' ? [{ id: proc.id, volumes: proc.volumes }] : []
  }) : []
  queryCaseVolume.value = typeof desk.queryCaseVolume === 'string' ? desk.queryCaseVolume : ''
  icEpoch.value += 1
  deskOwner = owner
  if (!sheetNotice.value) sheetNotice.value = '已从本机恢复账本找回这个系统上次留下的工作。'
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  if (holdCheck) {
    const done = settledKeys()
    const left = pendingCheckJobs()
    paintTaskCheckProgress(done.size, done.size + left.length, Date.now(), left.length ? 'hold' : 'done')
  }
  if (connection.value.sessionStatus === 'authenticated') {
    resumeHeldLimit()
    resumeHeldCheck()
  }
}

function pokeDesk(): void {
  if (parking) return
  scheduleRecovery('workflow-desk', deskScope(), readDesk)
}

watch([rows, icPhase, limitPhase, progress, arbitrationBoard, confirmedProcIds, sheetName, status, queryOpen], pokeDesk, { deep: true })

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
  liveMeter = null
  holdCheck = false
  holdLimit = false
  holdSpin = 0
  if (holdTimer) window.clearTimeout(holdTimer)
  holdTimer = 0
  resetTaskCheckProgress()
}

watch(() => connection.value.sessionStatus, (next, previous) => {
  if (next !== 'authenticated' || next === previous) return
  holdSpin = 0
  if (holdTimer) window.clearTimeout(holdTimer)
  holdTimer = 0
  resumeHeldLimit()
  resumeHeldCheck()
})

function volumeKey(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

function statusShade(text: string): string {
  if (text === '还没提交审核') return 'shade-open'
  if (text === '已经审核通过') return 'shade-done'
  if (text === MAILED_UNFINISHED_REVIEW) return 'shade-mailed'
  if (text === SKIP_SEND_REVIEW) return 'shade-skip'
  if (text === '已提交审核') return 'shade-pending'
  if (text === '异常') return 'shade-abnormal'
  if (text === '库里没有' || text === '没查成') return 'shade-missing'
  return ''
}

function reviewLabel(gate: 'open' | 'pending' | 'done' | undefined, hit?: { uncontrolled?: true; skipSend?: true }): string {
  if (hit?.skipSend) return SKIP_SEND_REVIEW
  if (gate === 'pending') return '已提交审核'
  if (gate === 'done' && hit?.uncontrolled) return MAILED_UNFINISHED_REVIEW
  if (gate === 'done') return '已经审核通过'
  if (gate === 'open') return '还没提交审核'
  return '—'
}

function icKey(volume: string, procLabel: string): string {
  return `${volumeKey(volume)}\n${procLabel.trim()}`
}

/** 这一行用来对状态的文号：我方文号空着时用客户文号，进国家表里只有客户文号的行也能对上。 */
function rowVolumeKey(row: PctTaskRow): string {
  return row.ourVolume.trim() || row.customerVolume
}

function limitReview(row: PctTaskRow): string {
  return limitByKey[icKey(rowVolumeKey(row), row.procLabel)] ?? ''
}

function sheetMemo(row: PctTaskRow): string {
  const status = sheetStatus(row)
  return `${status.found}\n${status.review}\n${row.ourVolume}\n${row.customerVolume}\n${row.ourVolumeCorrected ? 1 : 0}\n${row.customerVolumeCorrected ? 1 : 0}`
}

function sheetStatus(row: PctTaskRow): { found: string; review: string } {
  const base = sheetReview(row)
  if (abnormalKeys.value.has(icKey(rowVolumeKey(row), row.procLabel))) return { found: base.found || '有', review: '异常' }
  return base
}

function rowsForArbitration(): PctTaskRow[] {
  return rows.value.filter(row => reviewNeedsArbitration(sheetStatus(row).review, allowMailedUnfinished.value))
}

function sheetReview(row: PctTaskRow): { found: string; review: string } {
  const published = icEpoch.value
  const fromLimit = limitReview(row)
  const hit = published >= 0 ? icHits[icKey(rowVolumeKey(row), row.procLabel)] : undefined
  if (hit) {
    if (hit.unread) return { found: '没查成', review: '—' }
    if (hit.statusUnread) return { found: '有', review: '状态没读到' }
    if (!hit.found) {
      if (fromLimit && fromLimit !== '…') return { found: '有', review: fromLimit }
      return { found: '库里没有', review: '—' }
    }
    const fromFlow = hit.gate ? reviewLabel(hit.gate, hit) : ''
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

const flowByKey = computed(() => {
  const out: Record<string, string> = {}
  for (const row of rows.value) {
    const review = sheetStatus(row).review
    if (!review || review === '—' || review === '…') continue
    out[icKey(rowVolumeKey(row), row.procLabel)] = review
  }
  return out
})

function flowAsk(our: string, proc: string, customer = '', withRecord = false): FlowAsk | null {
  const ours = our.trim()
  const theirs = customer.trim()
  const caseVolume = ours || theirs
  const procLabel = proc.trim()
  if (!caseVolume || !procLabel) return null
  const ask: FlowAsk = { caseVolume, procLabel }
  if (!ours && theirs) ask.customerVolume = theirs
  else if (ours && theirs && volumeKey(ours) !== volumeKey(theirs)) ask.customerVolume = theirs
  if (withRecord) ask.withRecord = true
  return ask
}

function applyVolumeFixes(item: IcFlowHit): void {
  if (!item.correctedOur && !item.correctedCustomer) return
  const proc = item.procLabel.trim()
  const sent = volumeKey(item.caseVolume)
  for (const row of rows.value) {
    if (row.procLabel.trim() !== proc) continue
    if (volumeKey(row.ourVolume.trim() || row.customerVolume.trim()) !== sent) continue
    if (item.correctedOur && row.ourVolume.trim()) {
      row.ourVolume = item.correctedOur
      row.ourVolumeCorrected = true
    }
    if (item.correctedCustomer && row.customerVolume.trim()) {
      row.customerVolume = item.correctedCustomer
      row.customerVolumeCorrected = true
    }
  }
}

function hitFromItem(item: IcFlowHit): IcHit {
  if (item.unread) return { found: false, gate: '', unread: true }
  if (item.statusUnread) return { found: true, gate: '', statusUnread: true }
  return {
    found: item.found,
    gate: item.gate,
    ...(item.uncontrolled ? { uncontrolled: true as const } : {}),
    ...(item.skipSend ? { skipSend: true as const } : {})
  }
}

function rowAsk(row: PctTaskRow): FlowAsk | null {
  return flowAsk(row.ourVolume, row.procLabel, row.customerVolume, !row.iprName.trim())
}

function settledKeys(): Set<string> {
  const keys = new Set<string>()
  for (const row of rows.value) {
    const ask = rowAsk(row)
    if (!ask) continue
    const hit = icHits[icKey(ask.caseVolume, ask.procLabel)]
    if (hit && !hit.unread) keys.add(icKey(ask.caseVolume, ask.procLabel))
  }
  return keys
}

function pendingCheckJobs(): FlowAsk[] {
  const jobs: FlowAsk[] = []
  const seen = new Set<string>()
  const done = settledKeys()
  for (const row of rows.value) {
    const ask = rowAsk(row)
    if (!ask) continue
    const key = icKey(ask.caseVolume, ask.procLabel)
    if (seen.has(key) || done.has(key)) continue
    seen.add(key)
    jobs.push(ask)
  }
  return jobs
}

function finishInterruptedCheck(): void {
  icPhase.value = 'done'
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  const done = settledKeys().size
  paintTaskCheckProgress(done, done || 1, Date.now(), 'done')
  if (shouldAutoArbitrate({ fullCheck: true, phase: 'done', enabled: autoArbitrate.value, gaps: gapWaves.value.length, asking: askingGap.value })) {
    void askGaps()
  }
}

function giveUpHeldWork(): void {
  if (holdTimer) window.clearTimeout(holdTimer)
  holdTimer = 0
  if (holdCheck) {
    holdCheck = false
    icPhase.value = 'fail'
    icNote.value = '接回来之后核对还是被登录打断。可以点「整表再查」。'
    const done = settledKeys()
    const left = pendingCheckJobs()
    paintTaskCheckProgress(done.size, done.size + left.length, Date.now(), 'fail')
  }
  if (holdLimit) {
    holdLimit = false
    limitPhase.value = 'fail'
    limitNote.value = '接回来之后期限查询还是被登录打断。'
  }
}

/** 已经显示为登录中，就等会话重新变成已登录再继续。若会话一直没掉，也再试两次，避免接回和这次失败挤在同一刻。 */
function scheduleHeldResume(): void {
  if (holdTimer) return
  if (connection.value.sessionStatus !== 'authenticated') {
    holdSpin = 0
    return
  }
  holdSpin += 1
  if (holdSpin > 2) {
    giveUpHeldWork()
    return
  }
  holdTimer = window.setTimeout(() => {
    holdTimer = 0
    resumeHeldLimit()
    resumeHeldCheck()
  }, 400)
}

function resumeHeldLimit(): void {
  if (!holdLimit || connection.value.sessionStatus !== 'authenticated') return
  const procs = queryProcs.value.filter(item => isQueryGuid(item.id) && item.volumes.trim())
  if (!procs.length && !querySeed.value) {
    holdLimit = false
    return
  }
  holdLimit = false
  limitPhase.value = 'run'
  limitNote.value = '接回来了，继续查期限监控。'
  queryToken.value += 1
}

function resumeHeldCheck(): void {
  if (!holdCheck || resumingCheck || connection.value.sessionStatus !== 'authenticated' || !bridge) return
  const jobs = pendingCheckJobs()
  holdCheck = false
  if (!jobs.length) {
    if (rows.value.length) finishInterruptedCheck()
    return
  }
  resumingCheck = true
  void lookupCases(++sheetQueryToken, jobs, 'unread', true).finally(() => { resumingCheck = false })
}

async function lookupCases(token: number, only?: FlowAsk[], kind: 'unread' | 'missing' = 'unread', resume = false): Promise<void> {
  const again = Boolean(only)
  releasePublish()
  if (!resume) holdCheck = false
  const page = bridge
  const seen = new Set<string>()
  const source = only ?? rows.value.map(row => flowAsk(row.ourVolume, row.procLabel, row.customerVolume, !row.iprName.trim())).filter((row): row is FlowAsk => Boolean(row))
  const asked: Array<FlowAsk & { tries: number }> = []
  liveAsked = asked
  for (const row of source) {
    const ask = row.customerVolume && volumeKey(row.customerVolume) === volumeKey(row.caseVolume)
      ? row
      : flowAsk(row.caseVolume, row.procLabel, row.customerVolume ?? '', Boolean(row.withRecord))
    if (!ask) continue
    const key = icKey(ask.caseVolume, ask.procLabel)
    if (seen.has(key)) continue
    seen.add(key)
    asked.push({ ...ask, tries: 0 })
  }
  const prior = resume ? settledKeys() : new Set<string>()
  const meter = { total: prior.size + asked.length, startedAt: Date.now(), finished: new Set(prior) }
  liveMeter = meter
  if (!page || connection.value.sessionStatus !== 'authenticated') {
    holdCheck = true
    liveMeter = null
    liveAsked = null
    if (rows.value.length) icPhase.value = 'run'
    icNote.value = '还没连上 EASY。同一位登录人接回后会接着核对。'
    const done = settledKeys()
    const left = pendingCheckJobs()
    paintTaskCheckProgress(done.size, Math.max(done.size + left.length, meter.total), Date.now(), left.length ? 'hold' : 'done')
    return
  }
  const bound = page
  paintTaskCheckProgress(meter.finished.size, meter.total, meter.startedAt, 'run')
  await new Promise(resolve => window.setTimeout(resolve, 50))
  if (token !== sheetQueryToken) return
  icPhase.value = 'run'
  icNote.value = !again
    ? '正在用案件查询核对文号和流程状态…'
    : resume
      ? '接回来了，继续核对剩下的…'
      : kind === 'missing' ? '正在把库里没有的放回队尾…' : '正在把没查成的重新入队…'
  if (!again) {
    icHits = Object.create(null)
    recordByVolume = Object.create(null)
  }
  else {
    for (const job of asked) delete icHits[icKey(job.caseVolume, job.procLabel)]
  }
  icEpoch.value += 1
  let stopped = ''
  // 一批 48 行走同一条 LookupIcFlow。里面 8 个文号并成一次查询，同时 6 条连接。
  const batchSize = 48

  function publishRun(): void {
    if (token !== sheetQueryToken) return
    icNote.value = `正在核对 ${meter.finished.size}/${meter.total}…`
    icEpoch.value += 1
    paintTaskCheckProgress(meter.finished.size, meter.total, meter.startedAt, 'run')
    pokeDesk()
  }

  function schedulePublish(): void {
    if (publishTimer || token !== sheetQueryToken) return
    publishTimer = window.setTimeout(() => {
      publishTimer = 0
      publishRun()
    }, PUBLISH_MS)
  }

  function stage(key: string, hit: IcHit): void {
    icHits[key] = hit
    schedulePublish()
  }

  function rememberRecord(item: IcFlowHit): void {
    if (!item.customerInfo && !item.recordInfo) return
    const brief = { customer: item.customerInfo ?? '', record: item.recordInfo ?? '' }
    const keys = [item.caseVolume, item.correctedOur, item.correctedCustomer]
    for (const key of keys) {
      if (key?.trim()) recordByVolume[volumeKey(key)] = brief
    }
    const sent = volumeKey(item.caseVolume)
    const corrected = item.correctedOur ? volumeKey(item.correctedOur) : ''
    for (const row of rows.value) {
      const ours = volumeKey(row.ourVolume)
      const theirs = volumeKey(row.customerVolume)
      if (ours !== sent && theirs !== sent && (!corrected || (ours !== corrected && theirs !== corrected))) continue
      if (ours) recordByVolume[ours] = brief
      if (theirs) recordByVolume[theirs] = brief
    }
  }

  function store(item: IcFlowHit): void {
    applyVolumeFixes(item)
    rememberRecord(item)
    const hit = hitFromItem(item)
    const key = icKey(item.correctedOur || item.caseVolume, item.procLabel)
    stage(key, hit)
    const previous = icKey(item.caseVolume, item.procLabel)
    if (previous !== key) stage(previous, hit)
    meter.finished.add(previous)
  }

  function requeue(job: FlowAsk & { tries: number }): void {
    if (job.tries < 1) asked.push({ ...job, tries: job.tries + 1 })
    else {
      const key = icKey(job.caseVolume, job.procLabel)
      stage(key, { found: false, gate: '', unread: true })
      meter.finished.add(key)
    }
  }

  async function worker(): Promise<void> {
    while (token === sheetQueryToken && !stopped) {
      const jobs = asked.splice(0, batchSize)
      if (!jobs.length) return
      const response = await bound.request({
        type: MessageType.LookupIcFlow,
        payload: { rows: jobs.map(job => ({ caseVolume: job.caseVolume, procLabel: job.procLabel, ...(job.customerVolume ? { customerVolume: job.customerVolume } : {}), ...(job.withRecord ? { withRecord: true as const } : {}) })) }
      })
      if (token !== sheetQueryToken) return
      if (response.type !== MessageType.LookupIcFlowResult || !response.payload.ok) {
        const message = response.type === MessageType.LookupIcFlowResult && !response.payload.ok
          ? response.payload.error.message
          : response.type === MessageType.Error
            ? response.payload.message
            : '案件查询没有完成。'
        if (sessionInterrupted(message)) {
          stopped = message
          return
        }
        jobs.forEach(requeue)
        continue
      }
      const returned = new Set<string>()
      for (const item of response.payload.data.items) {
        const key = icKey(item.caseVolume, item.procLabel)
        returned.add(key)
        const job = jobs.find(entry => icKey(entry.caseVolume, entry.procLabel) === key)
        const tries = job?.tries ?? 0
        if (item.unread && tries < 1) {
          asked.push({ caseVolume: item.caseVolume, procLabel: item.procLabel, ...(job?.customerVolume ? { customerVolume: job.customerVolume } : {}), ...(job?.withRecord ? { withRecord: true as const } : {}), tries: tries + 1 })
          continue
        }
        store(item)
      }
      for (const job of jobs) {
        if (!returned.has(icKey(job.caseVolume, job.procLabel))) requeue(job)
      }
    }
  }

  try {
    await worker()
  } finally {
    releasePublish()
    if (liveAsked === asked) liveAsked = null
    if (liveMeter === meter) liveMeter = null
  }
  if (token !== sheetQueryToken) return
  icEpoch.value += 1
  const held = Boolean(stopped && sessionInterrupted(stopped))
  paintTaskCheckProgress(meter.finished.size, meter.total, meter.startedAt, held ? 'hold' : stopped ? 'fail' : 'done')
  if (stopped) {
    if (held) {
      holdCheck = true
      icPhase.value = 'run'
      icNote.value = '登录中断，核对先停在这里。同一位登录人接回后会接着查剩下的。'
      pokeDesk()
      scheduleHeldResume()
      return
    }
    holdSpin = 0
    icPhase.value = 'fail'
    icNote.value = stopped
    return
  }
  icPhase.value = 'done'
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  if (shouldAutoArbitrate({ fullCheck: resume || !again, phase: 'done', enabled: autoArbitrate.value, gaps: gapWaves.value.length, asking: askingGap.value })) {
    void askGaps()
  }
  let found = 0
  let unreadCount = 0
  for (const key of meter.finished) {
    const hit = icHits[key]
    if (!hit) continue
    if (hit.found) found += 1
    if (hit.unread) unreadCount += 1
  }
  const missed = unreadCount ? `${unreadCount} 件没查成，其余已经对过。` : ''
  const againLabel = kind === 'missing' ? '库里没有' : '没查成'
  icNote.value = again && !resume
    ? `${againLabel}的 ${meter.total} 行又对过，这次对上 ${found} 件。${missed}`
    : `案件查询对上 ${found} 件。${missed}结束的事项也会留在结果里。`
  holdSpin = 0
}

function jobsByFound(found: string): FlowAsk[] {
  const jobs: FlowAsk[] = []
  const seen = new Set<string>()
  for (const row of rows.value) {
    if (sheetStatus(row).found !== found) continue
    const ask = flowAsk(row.ourVolume, row.procLabel, row.customerVolume, !row.iprName.trim())
    if (!ask) continue
    const key = icKey(ask.caseVolume, ask.procLabel)
    if (seen.has(key)) continue
    seen.add(key)
    jobs.push(ask)
  }
  return jobs
}

function requeueFound(found: '没查成' | '库里没有', kind: 'unread' | 'missing', queuedNote: (count: number) => string): void {
  const jobs = jobsByFound(found)
  if (!jobs.length) return
  const queue = liveAsked
  const meter = liveMeter
  if (queue && meter && icPhase.value === 'run') {
    const queued = new Set(queue.map(job => icKey(job.caseVolume, job.procLabel)))
    let added = 0
    for (const job of jobs) {
      const key = icKey(job.caseVolume, job.procLabel)
      if (queued.has(key)) continue
      delete icHits[key]
      queue.push({ ...job, tries: 0 })
      queued.add(key)
      if (!meter.finished.delete(key)) meter.total += 1
      added += 1
    }
    if (added) {
      icEpoch.value += 1
      paintTaskCheckProgress(meter.finished.size, meter.total, meter.startedAt, 'run')
      icNote.value = queuedNote(added)
    }
    return
  }
  void lookupCases(++sheetQueryToken, jobs, kind)
}

function requeueUnread(): void {
  requeueFound('没查成', 'unread', count => `已把 ${count} 行没查成的放回正在核对的队列。`)
}

function requeueMissing(): void {
  requeueFound('库里没有', 'missing', count => `已把 ${count} 行库里没有的放进队尾。`)
}

function onLimitResult(payload: { items: LimitMonitorRow[]; gates: Record<string, 'open' | 'pending' | 'done'>; checking: boolean; message: string }): void {
  const seen = new Set<string>()
  for (const item of payload.items) {
    const key = icKey(item.caseVolume, item.ctrlProc)
    seen.add(key)
    const gate = payload.gates[item.procId]
    if (!gate) {
      if (payload.checking) {
        if (!limitByKey[key]) limitByKey[key] = '…'
      } else if (!limitByKey[key] || limitByKey[key] === '…' || limitByKey[key] === '已提交审核' || limitByKey[key] === '还没提交审核') {
        delete limitByKey[key]
      }
      continue
    }
    const review = gate === 'pending' ? '已提交审核' : gate === 'done' ? '已经审核通过' : '还没提交审核'
    if (limitByKey[key] !== review) limitByKey[key] = review
  }
  if (!payload.checking) {
    for (const key of Object.keys(limitByKey)) {
      if (!seen.has(key)) delete limitByKey[key]
    }
  }
  if (!payload.items.length && payload.message) limitNote.value = payload.message
  else if (!payload.checking && payload.items.length) limitNote.value = ''
  if (payload.checking) {
    limitPhase.value = 'run'
    return
  }
  if (sessionInterrupted(payload.message)) {
    holdLimit = true
    limitPhase.value = 'run'
    limitNote.value = '登录中断，期限查询先停住。同一位登录人接回后会接着查。'
    scheduleHeldResume()
    return
  }
  holdLimit = false
  const failed = !payload.items.length && /失败|中断|意外|还不能/.test(payload.message)
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
  // 提交是一件一封，预览也按一行一封生成，不再按同客户合并。
  const groups = rows.value.map(row => [row])
  const built = groups.map(group => {
    const row = group[0] ?? group[0]
    const typeId = row?.mailTypeId ?? ''
    const typeName = row?.mailTypeLabel ?? ''
    const current = profileFor(row?.customerName ?? '')
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
    holdLimit = true
    limitPhase.value = 'run'
    limitNote.value = '还没连上 EASY。同一位登录人接回后会接着查期限。'
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
    // 我方文号空着的行用客户文号查，进国家表只有客户文号的行才进得来。
    volumes: joinCaseVolumes(rows.value.filter(row => row.procLabel.trim() === (resolved.names[index] ?? '')).map(row => row.ourVolume.trim() || row.customerVolume.trim()).filter(Boolean))
  }))
  queryCaseVolume.value = ''
  querySeed.value = { ctrl_proc: ids.join(',') }
  const notes: string[] = []
  if (ids.length > 1) notes.push(`表格里有 ${ids.length} 种处理事项。查询一次带上这些事项和全部文号，一行只会命中其中一项。`)
  const customerOnly = rows.value.filter(row => !row.ourVolume.trim() && row.customerVolume.trim()).length
  if (customerOnly) notes.push(`${customerOnly} 行只有客户文号，期限监控按客户文号这栏带查。`)
  if (notes.length) limitNote.value = notes.join('')
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
      payload: {
        rows: unique.slice(0, IC_LOOKUP_WIDTH).map(item => {
          const row = rows.value.find(entry => volumeKey(entry.ourVolume) === volumeKey(item.caseVolume) && entry.procLabel.trim() === item.procLabel.trim())
          return flowAsk(item.caseVolume, item.procLabel, row?.customerVolume ?? '', !row?.iprName.trim()) ?? { caseVolume: item.caseVolume.trim(), procLabel: item.procLabel.trim() }
        })
      }
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
      applyVolumeFixes(item)
      const hit = hitFromItem(item)
      const key = icKey(item.correctedOur || item.caseVolume, item.procLabel)
      icHits[key] = hit
      const previous = icKey(item.caseVolume, item.procLabel)
      if (previous !== key) icHits[previous] = hit
    }
    icEpoch.value += 1
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

const missingCount = computed(() => rows.value.filter(row => sheetStatus(row).found === '库里没有').length)
const unreadCount = computed(() => rows.value.filter(row => sheetStatus(row).found === '没查成').length)
const liveTask = computed(() => {
  if (!rows.value.length) return null
  const names = [...new Set(rows.value.map(row => row.customerName.trim()).filter(Boolean))]
  const customer = names.length === 1 ? names[0] : names.length ? `表格里 ${names.length} 个客户` : '表格里没有客户名'
  const labels = [...new Set(rows.value.map(row => row.mailTypeLabel.trim()).filter(Boolean))]
  const detail = labels.map(label => `${label} ${rows.value.filter(row => row.mailTypeLabel.trim() === label).length} 件`).join('，')
  return {
    customer,
    detail: `${rows.value.length} 行。发文类型：${detail || '还没对上'}。已勾选 ${confirmedProcIds.value.length} 件。`
  }
})
const emit = defineEmits<{ liveTask: [value: { customer: string; detail: string } | null] }>()
watch(liveTask, value => emit('liveTask', value), { immediate: true })

function exportByVerdict(keep: (found: string) => boolean, filename: (count: number) => string): void {
  const sheets = missedSourceSheets(rows.value, row => {
    const found = sheetStatus(row).found
    return keep(found) ? found : ''
  }, runtime.value.columns)
  if (!sheets.length) return
  const count = sheets.reduce((sum, sheet) => sum + sheet.rows.length - 1, 0)
  downloadXlsxSheets(sheets, filename(count))
}

function exportMissing(): void {
  exportByVerdict(found => found === '库里没有', count => `库里没有-${count}行.xlsx`)
}

function exportUnread(): void {
  exportByVerdict(found => found === '没查成', count => `没查成-${count}行.xlsx`)
}

function exportArbitration(): void {
  const header = ['我方文号', '客户', '收件人', '身份', '抄送', '抄送身份', '依据']
  const body = arbitrationBoard.value.map(line => [
    line.volume,
    line.customer || '',
    line.unsure ? '拿不准' : line.recipient,
    line.role,
    line.cc || '无',
    line.ccRole,
    line.reason
  ])
  if (body.length < 1) return
  downloadXlsxSheets([{ name: '仲裁结果', rows: [header, ...body] }], `仲裁结果-${body.length}行.xlsx`)
}

function exportChecked(): void {
  const sheets = checkedSourceSheets(rows.value, row => {
    const status = sheetStatus(row)
    if (status.review && status.review !== '—' && status.review !== '…') return status.review
    return status.found
  }, runtime.value.columns)
  if (!sheets.length) return
  downloadXlsxSheets(sheets, `核对结果-${rows.value.length}行.xlsx`)
}

function cachedBrief(row: PctTaskRow): { customer: string; record: string } | undefined {
  for (const key of [row.ourVolume, row.customerVolume]) {
    const found = key.trim() ? recordByVolume[volumeKey(key)] : undefined
    if (found) return found
  }
  return undefined
}

function onArbitrationResult(event: Event): void {
  const detail = event instanceof CustomEvent ? event.detail : null
  const text = typeof detail === 'string'
    ? detail
    : detail && typeof detail === 'object' && 'text' in detail && typeof detail.text === 'string'
      ? detail.text
      : ''
  const open = typeof detail === 'string' || Boolean(detail && typeof detail === 'object' && 'open' in detail && detail.open)
  if (!text.trim()) {
    if (open && arbitrationBoard.value.length) arbitrationOpen.value = true
    return
  }
  const applied = applyArbitrationReply(rows.value, text, { iprOnly: arbitrateIprOnly.value })
  rows.value = applied.rows
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  const known = new Map(arbitrationBoard.value.map(item => [volumeKey(item.volume), item]))
  for (const decision of applied.decisions) {
    const row = rows.value.find(item => volumeKey(item.ourVolume) === volumeKey(decision.volume) || (item.customerVolume && volumeKey(item.customerVolume) === volumeKey(decision.volume)))
    known.set(volumeKey(decision.volume), { ...decision, customer: row?.customerName ?? '' })
  }
  arbitrationBoard.value = [...known.values()]
  const note = applied.written ? `仲裁写回 ${applied.written} 行。` : '这批回复没有对上的文号，没有写回表格。'
  const unsure = applied.unsure ? `拿不准 ${applied.unsure} 行，没有填收件人。` : ''
  sheetNotice.value = [note, unsure].filter(Boolean).join('')
  if (open && arbitrationBoard.value.length) arbitrationOpen.value = true
  try { buildPreview() } catch { /* 预览失败不撤回已经写回的行，也不挡住结果浮窗 */ }
}

function setAutoArbitrate(event: Event): void {
  autoArbitrate.value = (event.target as HTMLInputElement).checked
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  void chrome.storage.local.set({ [AUTO_ARBITRATE_KEY]: autoArbitrate.value })
}

function setAllowMailedUnfinished(event: Event): void {
  allowMailedUnfinished.value = (event.target as HTMLInputElement).checked
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  void chrome.storage.local.set({ [ALLOW_MAILED_UNFINISHED_KEY]: allowMailedUnfinished.value })
}

function setArbitrateIprOnly(event: Event): void {
  arbitrateIprOnly.value = (event.target as HTMLInputElement).checked
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  void chrome.storage.local.set({ [ARBITRATE_IPR_ONLY_KEY]: arbitrateIprOnly.value })
}

function applyCarryMode(): void {
  if (!rows.value.length) return
  rows.value = recarryCustomerContacts(rows.value, carryAcrossBreaks.value ? 'cross' : 'block').rows
  gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
  try { buildPreview() } catch { /* 预览失败不影响重新顺延 */ }
}

function setCarryAcrossBreaks(event: Event): void {
  carryAcrossBreaks.value = (event.target as HTMLInputElement).checked
  applyCarryMode()
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  void chrome.storage.local.set({ [CARRY_ACROSS_BREAKS_KEY]: carryAcrossBreaks.value })
}

function hideDesk(): void {
  void flushRecovery('workflow-desk', deskScope(), readDesk)
}

onMounted(() => {
  window.addEventListener('patmail-arbitration-result', onArbitrationResult)
  window.addEventListener('pagehide', hideDesk)
  const scope = deskScope()
  const legacy = deskOwner || props.operatorId || connection.value.operatorId
  const legacyScope = isQueryGuid(legacy) ? legacy.toLowerCase() : 'local'
  const saved = scope.endsWith('|local')
    ? Promise.resolve(null)
    : recallRecovery('workflow-desk', scope).then(payload => payload ?? recallRecovery('workflow-desk', legacyScope))
  void saved.then(payload => { if (!rows.value.length) applyDesk(payload) }).catch(() => { /* 没有账本就从空表开始 */ })
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  void chrome.storage.local.get([AUTO_ARBITRATE_KEY, ALLOW_MAILED_UNFINISHED_KEY, ARBITRATE_IPR_ONLY_KEY, CARRY_ACROSS_BREAKS_KEY]).then(stored => {
    if (stored[AUTO_ARBITRATE_KEY] === false) autoArbitrate.value = false
    if (stored[ALLOW_MAILED_UNFINISHED_KEY] === false) {
      allowMailedUnfinished.value = false
      gapWaves.value = iprArbitrationWaves(rowsForArbitration(), {}, {}, { iprOnly: arbitrateIprOnly.value })
    }
    if (stored[ARBITRATE_IPR_ONLY_KEY] === true) arbitrateIprOnly.value = true
    if (stored[CARRY_ACROSS_BREAKS_KEY] === true) {
      carryAcrossBreaks.value = true
      applyCarryMode()
    }
  }).catch(() => { /* 读不到就保持默认 */ })
  sheetRuler = document.createElement('span')
  sheetRuler.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none;'
  document.body.appendChild(sheetRuler)
  sheetObserver = new ResizeObserver(() => layoutSheet())
  layoutSheet()
})
onUnmounted(() => {
  window.removeEventListener('patmail-arbitration-result', onArbitrationResult)
  window.removeEventListener('pagehide', hideDesk)
  void flushRecovery('workflow-desk', deskScope(), readDesk)
  sheetObserver?.disconnect()
  if (holdTimer) window.clearTimeout(holdTimer)
  sheetRuler?.remove()
  sheetRuler = null
  sheetObserved = null
})

async function askGaps(retried = false): Promise<void> {
  if (askingGap.value) return
  if (!arbitrationReady.value) {
    sheetNotice.value = retried
      ? '没查成的重新查没有完成，没有交给仲裁。'
      : '核对还没结束，客户要求和著录项目还没齐，没有交给仲裁。'
    return
  }
  const missed = retried ? [] : jobsByFound('没查成')
  if (missed.length) {
    const token = ++sheetQueryToken
    sheetNotice.value = `还有 ${missed.length} 行没查成，先重新查一遍，查完再交给仲裁。`
    await lookupCases(token, missed, 'unread')
    if (token !== sheetQueryToken || icPhase.value !== 'done') return
    return askGaps(true)
  }
  const gaps = rows.value.filter(row => !row.iprName.trim() && reviewNeedsArbitration(sheetStatus(row).review, allowMailedUnfinished.value))
  const settled = rows.value.filter(row => !row.iprName.trim() && !reviewNeedsArbitration(sheetStatus(row).review, allowMailedUnfinished.value)).length
  if (!gaps.length) return
  askingGap.value = true
  try {
    const customerInfo: Record<string, string> = {}
    const caseInfo: Record<string, string> = {}
    for (const row of gaps) {
      const volume = row.ourVolume.trim() || row.customerVolume.trim()
      const cached = cachedBrief(row)
      const name = row.customerName.trim()
      if (cached?.customer && name && !customerInfo[name]) customerInfo[name] = cached.customer
      if (cached?.record && volume) caseInfo[volume] = cached.record
    }
    const eligible = gaps.filter(row => {
      const volume = row.ourVolume.trim() || row.customerVolume.trim()
      return Boolean(customerInfo[row.customerName.trim()]) || Boolean(caseInfo[volume])
    })
    const held = gaps.length - eligible.length
    const waves = iprArbitrationWaves(eligible, customerInfo, caseInfo, { iprOnly: arbitrateIprOnly.value }).filter(item => item.trim())
    if (!waves.length) {
      sheetNotice.value = '核对时没有带上这些行的客户要求和著录项目。不再另外查客户名单或案件，也没有交给仲裁。'
      return
    }
    const heldNote = held ? `${held} 行核对里没带上，没有再查。` : ''
    const settledNote = settled ? `${settled} 行已经提交、审核通过${allowMailedUnfinished.value ? '' : '，或未管制完成日不允许发文'}，没有交给仲裁。` : ''
    const modeNote = arbitrateIprOnly.value
      ? '开了「没要求时仲裁只写技术联系人」：客户没写发给谁的行，仲裁会把技术联系人写成收件人。'
      : '这一批没开「没要求时仲裁只写技术联系人」：客户没写发给谁的行一律拿不准留空，提交时走「信任AI」的圈选兜底。客户要求明确写了发给谁的行照要求写。'
    sheetNotice.value = [`用核对时暂存的材料，${eligible.length} 行分 ${waves.length} 批交给仲裁。助手只看这些文字，不再查接口。`, modeNote, heldNote, settledNote].filter(Boolean).join('')
    window.dispatchEvent(new CustomEvent('patmail-arbitrate', { detail: waves }))
  } finally {
    askingGap.value = false
  }
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
    <p v-else class="hint">一次读「提醒申请PCT」和「PCT进国家」两张表。进国家有客户文号就用贵方案号，没有客户文号就用我方案号。外观用涉外外观那一种。同一客户里空着的联系人默认只在连成整块时顺延补上，中间隔了别的客户就断开；「同客户隔行也顺延补上」打开后不受截断影响。完全空着的，核对时会带上客户要求和著录项目里的发明人、客户联系人。交给助手时只使用这份暂存，不再查客户名单或案件。助手按文号把收件人写回这一行。核对完成后可以导出，在原表上加一列审核状态。邮箱那一列不读。</p>
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
          <span class="sheet-pick">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="选择表格" @change="onSheet" />
            <span class="sheet-pick-face" :class="{ picked: sheetName }">
              <svg class="sheet-pick-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 3.5h6.2L19 9.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M13 3.8V9h5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M8.5 13.2h7M8.5 16.2h7M8.5 19h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
              <span v-hint.clip="sheetName || '选择表格'">{{ sheetName || '选择表格' }}</span>
            </span>
          </span>
        </label>
      </div>
      <p class="hint">勾上的事项一件一封。没勾选的不会因为同客户、同收件人被并进来。</p>
      <p v-for="note in styleNotes" :key="note" class="hint">{{ note }}</p>
      <p v-if="sheetNotice" class="hint">{{ sheetNotice }}</p>
      <div class="arbitrate-bar">
        <span v-if="gapWaves.length" v-hint="arbitrationHint">
          <button type="button" class="ghost" :disabled="askingGap || !arbitrationReady" @click="askGaps()">交给助手仲裁空着的收件人和抄送{{ gapWaves.length > 1 ? `（分 ${gapWaves.length} 批）` : '' }}</button>
        </span>
        <button v-if="icPhase === 'done' && rows.length" type="button" class="ghost" @click="exportChecked">导出核对表</button>
        <button v-if="arbitrationBoard.length" type="button" class="ghost" @click="arbitrationOpen = true">仲裁结果 {{ arbitrationBoard.length }}</button>
        <span class="arbitrate-auto-group">
          <label class="arbitrate-auto">
            <input type="checkbox" :checked="autoArbitrate" @change="setAutoArbitrate" />
            核对完状态之后自动开始仲裁（如果有缺失）
          </label>
          <label class="arbitrate-auto" v-hint="'状态是「已发文，事项未管制完成日」的行也允许勾选，并且允许提交。提交时这些行会先弹出警示框，列出文号要仔细核对。去掉勾选后这类行不能勾选，也不能提交，也不进仲裁。核对中和仲裁中这一项固定，都结束后到发文阶段才能改。'">
            <input type="checkbox" :checked="allowMailedUnfinished" :disabled="mailToggleLocked" @change="setAllowMailedUnfinished" />
            已发文未管制的行允许发文
          </label>
          <label class="arbitrate-auto" v-hint="'IPR 空着、客户要求也没写发给谁时：勾上后仲裁可以把著录项目里的技术联系人写成收件人；不勾（默认）这类行不写收件人，交给「全选联系人」兜底。只在核对前有效，核对开始就固定，要改就重新读表格。'">
            <input type="checkbox" :checked="arbitrateIprOnly" :disabled="optionLocked" @change="setArbitrateIprOnly" />
            没要求时仲裁只写技术联系人
          </label>
          <label class="arbitrate-auto" v-hint="'空着的联系人默认只在同一客户连成整块时往下补（第一行有、后面空行补「补」），中间隔了别的客户就断开。勾上后同一客户不管中间隔了多少别的客户，都沿用该客户最近一行。只在核对前有效：开始核对或已有仲裁结果后固定，避免和写回的结论冲突。'">
            <input type="checkbox" :checked="carryAcrossBreaks" :disabled="optionLocked" @change="setCarryAcrossBreaks" />
            同客户隔行也顺延补上
          </label>
        </span>
      </div>
      <p v-if="mailTypes.length === 0" class="hint">发文类型还没读到。确认已经连上后，重新打开这一页。</p>
      <p v-if="unmatched.length" class="hint">这 {{ unmatched.length }} 行没有对上发文类型，请点选。</p>
      <p v-for="note in procGaps" :key="note" class="hint">{{ note }}</p>
      <p class="hint">上面按我方文号和处理事项去期限监控里查还没办完的，不看出官方期限有没有过。流程状态跟着下面的核对一起填。</p>
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
        :flow-by-key="flowByKey"
        :flow-checking="icPhase === 'run'"
        :allow-mailed-unfinished="allowMailedUnfinished"
        @result="onLimitResult"
        @confirm="onSheetConfirm"
        @refresh-status="onRefreshStatus"
      />
      <p v-if="icPhase === 'fail'" class="error" role="alert">{{ icNote || '案件查询没有完成。' }} 已经出现在上面的行，先用上面的流程状态。</p>
      <p v-else-if="icNote" class="hint">{{ icNote }}</p>
      <p v-if="limitNote" class="hint">{{ limitNote }}</p>
      <div v-if="rows.length" class="toolbar">
        <span class="sheet-count">表格共 {{ rows.length }} 行</span>
        <div v-if="sheetPages > 1" class="pagination">
          <button class="ghost tiny" type="button" :disabled="sheetPageSafe <= 1" @click="setSheetPage(sheetPageSafe - 1)">上一页</button>
          <span>{{ sheetPageSafe }} / {{ sheetPages }}</span>
          <button class="ghost tiny" type="button" :disabled="sheetPageSafe >= sheetPages" @click="setSheetPage(sheetPageSafe + 1)">下一页</button>
        </div>
      </div>
      <div ref="sheetHost" v-if="rows.length" class="fit-table sheet-cols">
      <div v-for="n in sheetSeen" v-show="n === sheetPageSafe" :key="n">
      <table class="grid" :style="sheetTableStyle">
        <colgroup>
          <col v-for="(width, index) in sheetColWidths" :key="index" :style="{ width: width + 'px' }" />
        </colgroup>
        <thead><tr><th>我方文号</th><th>客户</th><th>客户文号</th><th>处理事项</th><th>发文类型</th><th>收件人</th><th>抄送</th><th>查询结果</th><th>审核状态</th></tr></thead>
        <tbody>
          <tr v-for="row in rowsOnSheetPage(n)" :key="row.ourVolume + '\n' + row.customerVolume + '\n' + row.procLabel" v-memo="[row, sheetMemo(row)]" :class="{ 'is-pending': sheetStatus(row).review === MAILED_UNFINISHED_REVIEW }">
            <td :class="{ 'volume-corrected': row.ourVolumeCorrected }"><span class="clip" v-hint.clip="row.ourVolume">{{ row.ourVolume }}</span></td>
            <td><span class="clip" v-hint.clip="row.customerName || '表格里没有'">{{ row.customerName || '表格里没有' }}</span></td>
            <td :class="{ 'volume-corrected': row.customerVolumeCorrected }"><span class="clip" v-hint.clip="row.customerVolume || '无'">{{ row.customerVolume || '无' }}</span></td>
            <td><span class="clip" v-hint.clip="row.procLabel">{{ row.procLabel }}</span></td>
            <td>
              <span v-if="row.mailTypeId" class="clip" v-hint.clip="row.mailTypeLabel">{{ row.mailTypeLabel }}</span>
              <MailTypeTreeSelect v-else :model-value="row.mailTypeId ?? ''" :options="mailTypeOptions" :disabled="mailTypes.length === 0" @update:model-value="setRowType(row.ourVolume, String($event))" />
            </td>
            <td>
              <span class="clip" v-hint.clip="shownTo(row)">{{ shownTo(row) }}</span>
              <span v-if="carriedContactNote(row)" class="clip" v-hint.clip="carriedContactNote(row)">{{ carriedContactNote(row) }}</span>
            </td>
            <td><span class="clip" v-hint.clip="shownCc(row)">{{ shownCc(row) }}</span></td>
            <td :class="statusShade(sheetStatus(row).found)"><span class="clip" v-hint.clip="sheetStatus(row).found">{{ sheetStatus(row).found }}</span></td>
            <td :class="statusShade(sheetStatus(row).review)"><span class="clip" v-hint.clip="sheetStatus(row).review">{{ sheetStatus(row).review }}</span></td>
          </tr>
        </tbody>
      </table>
      </div>
      </div>
      <p v-if="status" class="save-status" role="status">{{ status }}</p>
      <section v-if="rows.length && icPhase !== 'idle'" class="card inset">
        <h2>{{ outcome }}</h2>
        <ul v-if="outcomeBars.length" class="outcome-bars">
          <li v-for="bar in outcomeBars" :key="bar.key">
            <span class="outcome-bar-meta"><span>{{ bar.label }}</span><b>{{ bar.count }}</b></span>
            <span class="outcome-bar-track"><span :style="{ width: bar.percent + '%', background: bar.color }"></span></span>
          </li>
        </ul>
        <div class="outcome-actions">
          <button v-if="missingCount" type="button" class="ghost tiny" @click="exportMissing">导出库里没有 {{ missingCount }}</button>
          <button v-if="unreadCount" type="button" class="ghost tiny" @click="exportUnread">导出没查成 {{ unreadCount }}</button>
          <button v-if="unreadCount" type="button" class="ghost tiny" @click="requeueUnread">没查成重新入队 {{ unreadCount }}</button>
          <button v-if="missingCount" type="button" class="ghost tiny" @click="requeueMissing">库里没有放进队尾 {{ missingCount }}</button>
          <button type="button" class="solid tiny" :disabled="saving || icPhase === 'run'" @click="createAndSend">{{ saving ? '正在准备查询…' : '整表再查' }}</button>
        </div>
        <p class="hint">库里没有是查过、文号对不上，放进当前核对队列的队尾再查。没查成是这次请求没读到。整表再查会整张表重来，并补上客户联系人里唯一的邮箱。</p>
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
    <div v-if="arbitrationOpen" class="mask app-dialog" @click.self="arbitrationOpen = false">
      <div class="dialog arbitration-board" role="dialog" aria-labelledby="arbitration-title">
        <header>
          <h3 id="arbitration-title">仲裁结果 {{ arbitrationBoard.length }} 行</h3>
          <button type="button" class="ghost tiny" @click="exportArbitration">导出仲裁结果</button>
          <button type="button" aria-label="关闭" @click="arbitrationOpen = false">×</button>
        </header>
        <p>收件人只在 IPR（技术联系人）、发明人和客户联系人里选。商务、登录人、密送登录人仍按默认追加，不在这张表里改。没有要求也没有技术联系人的行留空，拿不准的行没有填进表格。「信任AI」按写回的人提交，空行再按发文规则勾选；「直接全选」不采用写回的收件人。</p>
        <div class="arbitration-scroll">
          <table class="grid">
            <thead>
              <tr>
                <th>我方文号</th><th>客户</th><th>收件人</th><th>身份</th><th>抄送</th><th>抄送身份</th><th>依据</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in arbitrationBoard" :key="line.volume" :class="{ 'is-unsure': line.unsure }">
                <td>{{ line.volume }}</td>
                <td>{{ line.customer || '—' }}</td>
                <td>{{ line.unsure ? '拿不准' : (line.recipient || '—') }}</td>
                <td>{{ line.role || '—' }}</td>
                <td>{{ line.cc || '无' }}</td>
                <td>{{ line.ccRole || '—' }}</td>
                <td>{{ line.reason || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
