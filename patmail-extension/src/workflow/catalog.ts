import type { PackagedWorkflow } from '../customer/mail-flow'
import { isQueryGuid } from '../query/query-validator'
import { resolvePctRuntime, type PctRuntimeConfig, type PctRuntimeInput } from './pct-config'
import { isSkillId, skillById } from './skills'

export interface WorkflowParam {
  id: string
  label: string
  value: string
  help: string
  /** 程序自己留的记号，页面上不给普通用户看。 */
  hidden?: boolean
}

export interface WorkflowStep {
  id: string
  title: string
  detail: string
  params: WorkflowParam[]
  /** 这一步用的是哪一项本领。 */
  skillId?: string
}

export interface WorkflowDefinition {
  id: string
  label: string
  summary: string
  steps: WorkflowStep[]
}

export interface WorkflowCatalog {
  workflows: WorkflowDefinition[]
}

const PCT_ID = 'pct-reminder'

const PCT_SKILLS: Array<[string, string]> = [
  ['entry', 'start'],
  ['sheet', 'read-sheet'],
  ['proc', 'check-name'],
  ['mail-type', 'match-letter'],
  ['mail-style', 'send-style'],
  ['recipients', 'people'],
  ['sender', 'sender'],
  ['review', 'review'],
  ['query', 'lookup']
]

export function defaultPctWorkflow(): WorkflowDefinition {
  return {
    id: PCT_ID,
    label: 'PCT提醒',
    summary: '把表格里要提醒的申请，整理成一封封准备发出的信。',
    steps: PCT_SKILLS.map(([id, skillId]) => stepFromSkill(id, skillId))
  }
}

function stepFromSkill(id: string, skillId: string): WorkflowStep {
  const skill = skillById(skillId)
  return {
    id,
    skillId,
    title: skill?.title ?? '这一步',
    detail: skill?.detail ?? '',
    params: (skill?.params ?? []).map(item => ({ ...item }))
  }
}

export function defaultWorkflowCatalog(): WorkflowCatalog {
  return { workflows: [defaultPctWorkflow()] }
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function cloneWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  return cloneData(definition)
}

export function cloneCatalog(catalog: WorkflowCatalog): WorkflowCatalog {
  return cloneData(catalog)
}

const BUILTIN_STEPS = new Set(defaultPctWorkflow().steps.map(item => item.id))

export function isBuiltinStep(id: string): boolean {
  return BUILTIN_STEPS.has(id)
}

export function isExtraParam(id: string): boolean {
  return /^extra-[a-z0-9-]{1,24}$/.test(id)
}

export function isExtraStep(id: string): boolean {
  return /^extra-step-[a-z0-9-]{1,24}$/.test(id)
}

export function nextExtraId(ids: string[], kind: 'param' | 'step'): string {
  const prefix = kind === 'step' ? 'extra-step' : 'extra'
  const accept = kind === 'step' ? isExtraStep : isExtraParam
  let n = ids.length + 1
  let id = `${prefix}-${n}`
  while (ids.includes(id) || !accept(id)) {
    n += 1
    id = `${prefix}-${n}`
    if (n > 200) return `${prefix}-x`
  }
  return id
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function paramValue(definition: WorkflowDefinition | null | undefined, stepId: string, paramId: string): string {
  const found = definition?.steps.find(item => item.id === stepId)?.params.find(item => item.id === paramId)
  return found?.value ?? ''
}

export function pctRuntimeFrom(definition: WorkflowDefinition | null | undefined): PctRuntimeConfig {
  const value = (stepId: string, paramId: string) => paramValue(definition, stepId, paramId)
  const input: PctRuntimeInput = {
    columns: {
      ourVolume: value('sheet', 'col_our'),
      customerVolume: value('sheet', 'col_customer_volume'),
      customerName: value('sheet', 'col_customer_name'),
      contactName: value('sheet', 'col_contact'),
      iprName: value('sheet', 'col_ipr'),
      procLabel: value('sheet', 'col_proc')
    },
    procLabel: value('proc', 'proc_label'),
    reminderKeyword: value('mail-type', 'type_keyword'),
    customerKeyword: value('mail-type', 'customer_keyword'),
    ourKeyword: value('mail-type', 'our_keyword'),
    cityKeyword: value('mail-type', 'city_keyword'),
    otherCityKeyword: value('mail-type', 'other_city_keyword'),
    customerRadio: value('mail-type', 'customer_radio'),
    ourRadio: value('mail-type', 'our_radio'),
    customerTypeId: value('mail-type', 'customer_type_id'),
    customerTypeName: value('mail-type', 'customer_type_name'),
    ourTypeId: value('mail-type', 'our_type_id'),
    ourTypeName: value('mail-type', 'our_type_name')
  }
  return resolvePctRuntime(input)
}

function styleValue(definition: WorkflowDefinition, paramId: string, fallback: '1' | '2' | '3', used: Set<string>): '1' | '2' | '3' {
  const raw = paramValue(definition, 'mail-style', paramId).trim()
  const wanted = raw === '1' || raw === '2' || raw === '3' ? raw : fallback
  if (!used.has(wanted)) return wanted
  if (!used.has(fallback)) return fallback
  const free = (['1', '2', '3'] as const).find(item => !used.has(item))
  return free ?? fallback
}

function styleOptions(definition: WorkflowDefinition): { value: string; label: string }[] {
  const slots: Array<{ valueId: string; fallback: '1' | '2' | '3'; labelId: string; label: string }> = [
    { valueId: 'style_1_value', fallback: '1', labelId: 'style_1_label', label: '同客户合并发文' },
    { valueId: 'style_2_value', fallback: '2', labelId: 'style_2_label', label: '单个来文发文' },
    { valueId: 'style_3_value', fallback: '3', labelId: 'style_3_label', label: '同客户第一联系人合并发文' }
  ]
  const used = new Set<string>()
  return slots.map(slot => {
    const value = styleValue(definition, slot.valueId, slot.fallback, used)
    used.add(value)
    return { value, label: textOf(definition, 'mail-style', slot.labelId, slot.label) }
  })
}

function textOf(definition: WorkflowDefinition, stepId: string, paramId: string, fallback: string): string {
  const value = paramValue(definition, stepId, paramId).trim()
  return value || fallback
}

function volumeDecidedBy(runtime: PctRuntimeConfig): string {
  const customer = runtime.customerTypeName
    ? `有客户文号时用「${runtime.customerTypeName}」`
    : `有客户文号时找带「${runtime.customerKeyword}」和「${runtime.cityKeyword}」的`
  const ours = runtime.ourTypeName
    ? `只有我方文号时用「${runtime.ourTypeName}」`
    : `只有我方文号时找带「${runtime.ourKeyword}」和「${runtime.cityKeyword}」、而且不是「${runtime.otherCityKeyword}」的`
  return `到已经有的发文类型里对。${customer}。${ours}。`
}

function senderDecidedBy(definition: WorkflowDefinition): string {
  const picked = workflowSender(definition)
  const fallback = textOf(definition, 'sender', 'sender_fallback', '先用规则里记住的邮箱，再否则用客户上记住的')
  return picked ? `优先用「${picked.label}」。没选到时，${fallback}。` : fallback
}

/** 工作流里点名的发件邮箱。没点，或不是一份真实邮箱时，当没选。 */
export function workflowSender(definition: WorkflowDefinition | null | undefined): { id: string; label: string } | null {
  const id = paramValue(definition, 'sender', 'sender_mailset').trim()
  if (!isQueryGuid(id)) return null
  return { id, label: paramValue(definition, 'sender', 'sender_mailset_label').trim() || '已选的邮箱' }
}

/** 客户管理里看到的说明和选项，跟工作流页保存的参数一致。 */
export function packagedPctWorkflow(definition: WorkflowDefinition): PackagedWorkflow {
  const runtime = pctRuntimeFrom(definition)
  const column = runtime.columns
  const reviewLabel = textOf(definition, 'review', 'review_label', '提交给当前登录人')
  return {
    id: 'pct-reminder',
    label: definition.label.trim() || 'PCT提醒',
    surface: 'limit',
    modes: [
      { id: 'ctrl_proc', label: '处理事项', decidedBy: `表格「${column.procLabel}」。上传后按这个名字，到系统里的事项列表对上再查。整列应对上「${runtime.procLabel}」。` },
      { id: 'our_volume', label: '我方文号', decidedBy: `表格「${column.ourVolume}」。${textOf(definition, 'query', 'query_by', '我方文号和处理事项')}。` },
      { id: 'customer_volume', label: '客户文号', decidedBy: `表格「${column.customerVolume}」。` },
      { id: 'volume', label: '发文类型', decidedBy: volumeDecidedBy(runtime) },
      {
        id: 'mail_style',
        label: '发文模式',
        options: styleOptions(definition)
      },
      { id: 'customer_name', label: '客户名称', decidedBy: `表格「${column.customerName}」。` },
      { id: 'to', label: '收件人', decidedBy: `表格「${column.contactName}」，角色是${textOf(definition, 'recipients', 'to_role', '第一发明人（技术联系人）')}。` },
      { id: 'cc', label: '抄送', decidedBy: `${textOf(definition, 'recipients', 'cc_business_role', '商务')}，以及表格「${column.iprName}」（${textOf(definition, 'recipients', 'cc_ipr_role', 'IPR')}）。` },
      { id: 'from', label: '发件人', decidedBy: senderDecidedBy(definition) },
      { id: 'review', label: '审核', options: [{ value: 'self', label: reviewLabel }] }
    ]
  }
}

function cleanParam(raw: unknown, builtin?: WorkflowParam): WorkflowParam | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return builtin ? { ...builtin } : null
  const id = raw.id
  const extra = isExtraParam(id)
  if (!builtin && !extra) return null
  const base = builtin
  const hidden = base?.hidden === true || raw.hidden === true
  return {
    id: base?.id ?? id,
    label: clip(raw.label, 40) || base?.label || '新参数',
    value: clip(raw.value, 200),
    help: clip(raw.help, 400) || base?.help || '',
    ...(hidden ? { hidden: true } : {})
  }
}

function mergeStep(base: WorkflowStep, saved: unknown): WorkflowStep {
  if (!isRecord(saved)) return structuredClone(base)
  const incoming = Array.isArray(saved.params) ? saved.params : []
  const used = new Set<string>()
  const custom: WorkflowParam[] = []
  const overridden = new Map<string, WorkflowParam>()
  for (const item of incoming) {
    if (!isRecord(item) || typeof item.id !== 'string' || used.has(item.id)) continue
    const builtin = base.params.find(param => param.id === item.id)
    const cleaned = cleanParam(item, builtin)
    if (!cleaned) continue
    used.add(cleaned.id)
    if (builtin) overridden.set(builtin.id, cleaned)
    else custom.push(cleaned)
  }
  return {
    id: base.id,
    skillId: base.skillId,
    title: clip(saved.title, 40) || base.title,
    detail: Object.prototype.hasOwnProperty.call(saved, 'detail') ? clip(saved.detail, 800) : base.detail,
    params: [...base.params.map(param => overridden.get(param.id) ?? { ...param }), ...custom].slice(0, 24)
  }
}

function cleanCustomStep(raw: unknown): WorkflowStep | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isExtraStep(raw.id)) return null
  const skill = isSkillId(raw.skillId) ? skillById(raw.skillId) : null
  const base = skill
    ? stepFromSkill(raw.id, skill.id)
    : { id: raw.id, title: '补充说明', detail: '', params: [] }
  const merged = mergeStep(base, raw)
  return skill ? { ...merged, skillId: skill.id } : { ...merged, skillId: undefined }
}

function mergePct(saved: unknown): WorkflowDefinition {
  const base = defaultPctWorkflow()
  const record = isRecord(saved) ? saved : {}
  const incoming = Array.isArray(record.steps) ? record.steps : []
  const used = new Set<string>()
  const steps: WorkflowStep[] = []
  for (const item of incoming) {
    if (!isRecord(item) || typeof item.id !== 'string' || used.has(item.id)) continue
    if (BUILTIN_STEPS.has(item.id)) {
      const builtin = base.steps.find(step => step.id === item.id)
      if (!builtin) continue
      steps.push(mergeStep(builtin, item))
      used.add(item.id)
    } else {
      const extra = cleanCustomStep(item)
      if (!extra) continue
      steps.push(extra)
      used.add(extra.id)
    }
  }
  for (const builtin of base.steps) {
    if (!used.has(builtin.id)) steps.push(structuredClone(builtin))
  }
  return {
    id: PCT_ID,
    label: clip(record.label, 40) || base.label,
    summary: clip(record.summary, 400) || base.summary,
    steps: steps.slice(0, 16)
  }
}

function parseExtraWorkflow(raw: unknown): WorkflowDefinition | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  if (raw.id === PCT_ID || !/^[a-z][a-z0-9-]{0,40}$/.test(raw.id)) return null
  const steps: WorkflowStep[] = []
  if (Array.isArray(raw.steps)) {
    for (const item of raw.steps) {
      const cleaned = cleanCustomStep({ ...(isRecord(item) ? item : {}), id: isRecord(item) && typeof item.id === 'string' && isExtraStep(item.id) ? item.id : '' })
      if (cleaned) steps.push(cleaned)
    }
  }
  return {
    id: raw.id,
    label: clip(raw.label, 40) || raw.id,
    summary: clip(raw.summary, 400),
    steps: steps.slice(0, 16)
  }
}

export function normalizeWorkflowCatalog(input: unknown): WorkflowCatalog {
  const rawList = isRecord(input) && Array.isArray(input.workflows) ? input.workflows : []
  let pct: WorkflowDefinition | null = null
  const extras: WorkflowDefinition[] = []
  for (const item of rawList) {
    if (!isRecord(item)) continue
    if (item.id === PCT_ID) pct = mergePct(item)
    else {
      const extra = parseExtraWorkflow(item)
      if (extra && !extras.some(flow => flow.id === extra.id)) extras.push(extra)
    }
  }
  return { workflows: [pct ?? defaultPctWorkflow(), ...extras].slice(0, 8) }
}

const FILLED_ON_SAVE = new Set([
  'col_our', 'col_customer_volume', 'col_customer_name', 'col_contact', 'col_ipr', 'col_proc',
  'proc_label', 'type_keyword', 'customer_keyword', 'our_keyword', 'city_keyword', 'other_city_keyword'
])

export function paramWarning(param: WorkflowParam): string {
  if (param.hidden) return ''
  if (FILLED_ON_SAVE.has(param.id) && !param.value.trim()) return '这里空着的话，还会用原来的写法。'
  return ''
}

export function nextFlowId(ids: string[]): string {
  let n = 1
  let id = `flow-${n}`
  while (ids.includes(id) || id === PCT_ID) {
    n += 1
    id = `flow-${n}`
    if (n > 40) return 'flow-x'
  }
  return id
}

/** 按点选顺序，把几项本领串成一条新的工作流。 */
export function workflowFromSkills(name: string, skillIds: string[], existingIds: string[]): WorkflowDefinition {
  const used: string[] = []
  const steps = skillIds.flatMap(skillId => {
    if (!isSkillId(skillId) || !skillById(skillId)) return []
    const id = nextExtraId(used, 'step')
    used.push(id)
    return [stepFromSkill(id, skillId)]
  })
  return {
    id: nextFlowId(existingIds),
    label: name.trim().slice(0, 40) || '我的工作流',
    summary: '从知识海洋里挑出来的一条。',
    steps: steps.slice(0, 16)
  }
}
