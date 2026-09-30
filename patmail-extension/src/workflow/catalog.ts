import type { PackagedWorkflow } from '../customer/mail-flow'
import { inventorCustomers } from '../customer/pct-recipients'
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
  /** 系统自带的。页面上不能改，只能复制成副本。 */
  system?: boolean
}

export interface WorkflowCatalog {
  workflows: WorkflowDefinition[]
}

const PCT_ID = 'pct-reminder'
const PENGCHENG_ID = 'pct-pengcheng'
const SYSTEM_IDS = new Set([PCT_ID, PENGCHENG_ID])

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
    system: true,
    steps: PCT_SKILLS.map(([id, skillId]) => stepFromSkill(id, skillId))
  }
}

export function isSystemWorkflow(flow: { id?: string } | null | undefined): boolean {
  return typeof flow?.id === 'string' && SYSTEM_IDS.has(flow.id)
}

const RUN_SKILLS = ['start', 'read-sheet', 'check-name', 'match-letter', 'send-style', 'people', 'sender', 'review', 'lookup']

/** 能生成预览并提交的，是带齐这些步骤的工作流。不看流程编号。 */
export function isRunnableWorkflow(definition: { steps: Array<{ skillId?: string }> } | null | undefined): boolean {
  if (!definition) return false
  const skills = new Set(definition.steps.map(step => step.skillId))
  return RUN_SKILLS.every(skill => skills.has(skill))
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

export function defaultPengchengWorkflow(): WorkflowDefinition {
  const steps = PCT_SKILLS.map(([id, skillId]) => stepFromSkill(id, skillId))
  const sheet = steps.find(step => step.id === 'sheet')
  if (sheet) {
    sheet.detail = '上传一份表格。收件人读技术负责人，抄送读客户联系人(IPR)，再抄商务。邮箱那一列不读。'
    sheet.params.push({
      id: 'col_lead',
      label: '技术负责人那一列',
      value: '技术负责人',
      help: '收件人从这一列取。括号里的拼音会去掉，再去对联系人。邮箱那一列不读。'
    })
  }
  const people = steps.find(step => step.id === 'recipients')
  if (people) {
    people.detail = '收件人是表格里的技术负责人。括号里的拼音会去掉再对联系人。抄送是表格里的 IPR，再加上发文页的商务。'
    people.params = [
      { id: 'recipient_mode', label: '收件方式', value: 'lead', help: 'lead 是技术负责人收、IPR 和商务抄送。', hidden: true },
      { id: 'to_role', label: '收件人', value: '技术负责人', help: '从表格「技术负责人」读。括号里的拼音会去掉。' },
      { id: 'cc_ipr_role', label: '抄送里的 IPR', value: 'IPR', help: '从表格「客户联系人(IPR)」读。' },
      { id: 'cc_business_role', label: '同时抄送', value: '商务', help: '从发文页的商务联系人读，不从表格读。' }
    ]
  }
  return {
    id: PENGCHENG_ID,
    label: 'PCT鹏城专案',
    summary: '收件人是技术负责人，抄送是 IPR 和商务。',
    system: true,
    steps
  }
}

export function defaultWorkflowCatalog(): WorkflowCatalog {
  return { workflows: [defaultPctWorkflow(), defaultPengchengWorkflow()] }
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
  const used = new Set(ids)
  let n = 1
  let id = `${prefix}-${n}`
  while (used.has(id) || !accept(id)) {
    n += 1
    id = `${prefix}-${n}`
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
      leadName: value('sheet', 'col_lead'),
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

export function recipientModeOf(definition: WorkflowDefinition | null | undefined): 'ipr' | 'lead' {
  const step = definition?.steps.find(item => item.skillId === 'people') ?? definition?.steps.find(item => item.id === 'recipients')
  const value = step?.params.find(item => item.id === 'recipient_mode')?.value ?? ''
  return value === 'lead' ? 'lead' : 'ipr'
}

/** 任务上记下的收件方式优先。旧任务没有这一项时，按它所属工作流的参数。 */
export function recipientModeForTask(
  task: { workflowId?: string; recipientMode?: string } | null | undefined,
  workflows: WorkflowDefinition[]
): 'ipr' | 'lead' {
  if (task?.recipientMode === 'lead' || task?.recipientMode === 'ipr') return task.recipientMode
  return recipientModeOf(workflows.find(item => item.id === task?.workflowId))
}

/** 用户在「谁来收」里写下的客户。这些客户发给第一发明人、抄送 IPR。 */
export function inventorCustomerNames(definition: WorkflowDefinition | null | undefined): Set<string> {
  return inventorCustomers(paramValue(definition, 'recipients', 'inventor_customers'))
}

/** 工作流里点名的发件邮箱。没点，或不是一份真实邮箱时，当没选。 */
export function workflowSender(definition: WorkflowDefinition | null | undefined): { id: string; label: string } | null {
  const id = paramValue(definition, 'sender', 'sender_mailset').trim()
  if (!isQueryGuid(id)) return null
  return { id, label: paramValue(definition, 'sender', 'sender_mailset_label').trim() || '已选的邮箱' }
}

/** 客户管理里看到的说明和选项，跟工作流页保存的参数一致。 */
export function packagedPctWorkflow(definition: WorkflowDefinition): Omit<PackagedWorkflow, 'id'> & { id: string } {
  const runtime = pctRuntimeFrom(definition)
  const column = runtime.columns
  const reviewLabel = textOf(definition, 'review', 'review_label', '提交给当前登录人')
  return {
    id: definition.id,
    label: definition.label.trim() || definition.id,
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
      { id: 'to', label: '收件人', decidedBy: recipientModeOf(definition) === 'lead'
        ? `表格「${column.leadName || '技术负责人'}」。括号里的拼音会去掉再对联系人。`
        : `表格「${column.iprName}」。` },
      { id: 'cc', label: '抄送', decidedBy: recipientModeOf(definition) === 'lead'
        ? `表格「${column.iprName}」，再加上发文页的${textOf(definition, 'recipients', 'cc_business_role', '商务')}。`
        : `发文页的${textOf(definition, 'recipients', 'cc_business_role', '商务')}。` },
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
    params: [...base.params.map(param => overridden.get(param.id) ?? { ...param }), ...custom]
  }
}

function isLeadPeople(raw: unknown): boolean {
  if (!isRecord(raw) || !Array.isArray(raw.params)) return false
  return raw.params.some(item => isRecord(item) && item.id === 'recipient_mode' && item.value === 'lead')
}

function cleanCustomStep(raw: unknown): WorkflowStep | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isExtraStep(raw.id)) return null
  const skill = isSkillId(raw.skillId) ? skillById(raw.skillId) : null
  if (skill?.id === 'people' && !isLeadPeople(raw)) return stepFromSkill(raw.id, 'people')
  const lead = skill?.id === 'people' ? defaultPengchengWorkflow().steps.find(step => step.skillId === 'people') : null
  const base = lead
    ? { ...structuredClone(lead), id: raw.id }
    : skill
      ? stepFromSkill(raw.id, skill.id)
      : { id: raw.id, title: '补充说明', detail: '', params: [] }
  const merged = mergeStep(base, raw)
  return skill ? { ...merged, skillId: skill.id } : { ...merged, skillId: undefined }
}

const STALE_YES = new Set(['有', '无', '是', '否'])

/** 系统工作流的说法、步骤始终跟当前定义走。已经写下的参数值留着。旧的「有/无」抄送开关改回业务人员。 */
function applySavedValues(step: WorkflowStep, saved: Record<string, unknown> | undefined): WorkflowStep {
  const next = structuredClone(step)
  if (!saved || !Array.isArray(saved.params)) return next
  for (const item of saved.params) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.value !== 'string') continue
    const param = next.params.find(entry => entry.id === item.id)
    if (!param) continue
    const value = clip(item.value, 200)
    const builtin = step.params.find(entry => entry.id === param.id)?.value ?? param.value
    const staleCc = param.id === 'cc_business_role' && (STALE_YES.has(value) || value === '业务人员')
    param.value = staleCc ? builtin : value
  }
  return next
}

function mergePct(saved: unknown): WorkflowDefinition {
  const base = defaultPctWorkflow()
  const incoming = isRecord(saved) && Array.isArray(saved.steps) ? saved.steps : []
  const savedSteps = new Map<string, Record<string, unknown>>()
  for (const item of incoming) {
    if (!isRecord(item) || typeof item.id !== 'string' || savedSteps.has(item.id)) continue
    if (BUILTIN_STEPS.has(item.id)) savedSteps.set(item.id, item)
  }
  return {
    id: PCT_ID,
    label: base.label,
    summary: base.summary,
    system: true,
    steps: base.steps.map(step => step.id === 'recipients' ? structuredClone(step) : applySavedValues(step, savedSteps.get(step.id)))
  }
}

function parseExtraWorkflow(raw: unknown): WorkflowDefinition | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  if (SYSTEM_IDS.has(raw.id) || !/^[a-z][a-z0-9-]{0,40}$/.test(raw.id)) return null
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
    system: false,
    steps
  }
}

export function normalizeWorkflowCatalog(input: unknown): WorkflowCatalog {
  const rawList = isRecord(input) && Array.isArray(input.workflows) ? input.workflows : []
  let pct: WorkflowDefinition | null = null
  const extras: WorkflowDefinition[] = []
  for (const item of rawList) {
    if (!isRecord(item)) continue
    if (item.id === PCT_ID) pct = mergePct(item)
    else if (item.id === PENGCHENG_ID) continue
    else {
      const extra = parseExtraWorkflow(item)
      if (extra && !extras.some(flow => flow.id === extra.id)) extras.push(extra)
    }
  }
  return { workflows: [pct ?? defaultPctWorkflow(), defaultPengchengWorkflow(), ...extras] }
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
  const used = new Set(ids)
  let n = 1
  let id = `flow-${n}`
  while (used.has(id) || SYSTEM_IDS.has(id)) {
    n += 1
    id = `flow-${n}`
  }
  return id
}

function copyLabel(label: string, labels: string[]): string {
  const base = label.replace(/\s*副本\d*$/, '').trim() || '工作流'
  const taken = new Set(labels)
  let name = `${base} 副本`
  let n = 2
  while (taken.has(name)) {
    name = `${base} 副本${n}`
    n += 1
  }
  return name.slice(0, 40)
}

/** 复制成可以修改的副本。步骤换成自己的编号，说法跟当前本领一致，已经写下的值留着。 */
export function duplicateWorkflow(source: WorkflowDefinition, existingIds: string[], existingLabels: string[]): WorkflowDefinition {
  const used: string[] = []
  const steps = source.steps.flatMap(step => {
    const id = nextExtraId(used, 'step')
    used.push(id)
    if (!step.skillId || !isSkillId(step.skillId)) {
      const copied = structuredClone(step)
      copied.id = id
      delete copied.skillId
      return [copied]
    }
    const fresh = stepFromSkill(id, step.skillId)
    const params = fresh.params.map(param => {
      const saved = step.params.find(item => item.id === param.id)
      return saved ? { ...param, value: clip(saved.value, 200) } : param
    })
    const extras = step.params.filter(item => isExtraParam(item.id)).map(item => ({ ...item }))
    return [{ ...fresh, params: [...params, ...extras] }]
  })
  return {
    id: nextFlowId(existingIds),
    label: copyLabel(source.label, existingLabels),
    summary: clip(source.summary, 400),
    system: false,
    steps
  }
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
    system: false,
    steps
  }
}
