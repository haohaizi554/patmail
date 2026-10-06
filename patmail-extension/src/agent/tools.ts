import type { SelectedPatentFile } from '../mail/types'
import { isMessage, MessageType, type ContentRequest } from '../shared/message'
import { clipToolResult, rememberFact, searchFacts, type AgentMemoryState } from './memory'
import type { ToolSchema } from './llm'

export interface DeadlineRow {
  procId: string
  caseId: string
  caseVolume: string
}

export interface ToolContext {
  /** 经工作台转发到已绑定的 EASY 标签页。失败时返回 { error }。 */
  forward(message: ContentRequest): Promise<unknown>
  snapshot(): { connected: boolean; displayName: string; origin: string; message: string }
  customers(): Promise<Array<{ name: string; workflowId: string; surface: string }>>
  workflows(): Promise<Array<{ label: string; summary: string; steps: Array<{ title: string; detail: string }> }>>
  skills(): Array<{ title: string; blurb: string; detail: string }>
  /** 在 API/ 全部接口文档里按 Call、入口或中文主题取片段。 */
  lookupApi(query: string): string
  /** 按本领创建一条工作流，写进工作流目录。 */
  createWorkflow(input: { name: string; summary: string; skills: string }): Promise<string>
  /** 改一条非系统工作流上的某一栏。 */
  setWorkflowField(input: { name: string; skill: string; field: string; value: string }): Promise<string>
  /** 按查到的文件创建一条发文任务。不提交到 EASY。 */
  createTask(input: { caseVolume: string; applicationNo: string; customerName: string; fileName: string }): Promise<string>
  rememberFiles(files: SelectedPatentFile[]): void
  recentFiles(): SelectedPatentFile[]
  rememberDeadlines(rows: DeadlineRow[]): void
  recentDeadlines(): DeadlineRow[]
  submitEasy(caseVolume: string): Promise<string>
  readCustomer(name: string): Promise<string>
  previewWorkflow(name: string): Promise<string>
  draftMail(customerName: string): Promise<string>
  listTasks(): Promise<string>
  listHistory(surface: string): Promise<string>
  listReviewers(): Promise<string>
  listProcesses(kind: string, searchKey: string): Promise<string>
  listAcceptance(): Promise<string>
  readonlyAcceptance(call: string, caseTypeId: string, mailId: string): Promise<string>
  diagnoseMail(mailId: string): Promise<string>
  exportContacts(volumes: string): Promise<string>
}

/** 起草结果的固定句式。主题和没收录的占位符都留在原文里。 */
export function formatDraft(parts: { letters: number; subject: string; body: string; notes: string[]; who: string }): string {
  const body = parts.body.trim()
  const shown = body.length > 600 ? `${body.slice(0, 600)}…` : body
  const notes = parts.notes.map(note => note.trim()).filter(Boolean)
  return [
    `起草完成。分成 ${parts.letters} 封。没有提交到 EASY。`,
    `主题：${parts.subject.trim() || '（空）'}`,
    `正文：${shown || '（空）'}`,
    parts.who.trim(),
    notes.length ? notes.join('\n') : '占位符都已填上。'
  ].filter(Boolean).join('\n')
}

function asSelected(item: {
  fileId?: string
  fileName?: string
  fileDescription?: string
  customerName?: string
  caseId?: string
  caseName?: string
  caseVolume?: string
  customerVolume?: string
  applicationNo?: string
  officialPostDate?: string
}): SelectedPatentFile | null {
  if (!item.fileId || !item.fileName) return null
  return {
    fileId: item.fileId,
    fileName: item.fileName,
    fileDescription: item.fileDescription ?? '',
    customerName: item.customerName ?? '',
    ...(item.caseId ? { caseId: item.caseId } : {}),
    ...(item.caseName ? { caseName: item.caseName } : {}),
    ...(item.caseVolume ? { caseVolume: item.caseVolume } : {}),
    ...(item.customerVolume ? { customerVolume: item.customerVolume } : {}),
    ...(item.applicationNo ? { applicationNo: item.applicationNo } : {}),
    ...(item.officialPostDate ? { officialPostDate: item.officialPostDate } : {})
  }
}

const SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'connection_status',
      description: '查看当前是否已连上 EASY、登录人是谁。查案件或期限之前先看这个。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_cases',
      description: '在 EASY 文件管理里按我方文号、申请号、客户或文件名查案件文件。至少给一项条件。',
      parameters: {
        type: 'object',
        properties: {
          caseVolume: { type: 'string', description: '我方文号' },
          applicationNo: { type: 'string', description: '申请号' },
          customerName: { type: 'string', description: '客户名称，可模糊' },
          fileName: { type: 'string', description: '文件名' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_deadlines',
      description: '在期限监控里查还没结束的处理事项和内部/客户/法律期限。',
      parameters: {
        type: 'object',
        properties: {
          caseVolume: { type: 'string', description: '我方文号' },
          applicationNo: { type: 'string', description: '申请号' },
          customerName: { type: 'string', description: '客户名称' },
          kind: { type: 'string', enum: ['all', 'pay', 'suspend', 'abandon', 'recall', 'priority', 'fee'], description: '页签，不确定就用 all' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_customers',
      description: '列出这位登录人在插件里配过的客户，以及各自走哪条工作流。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'describe_workflows',
      description: '用大白话说明一条已有的发文工作流要做什么。不给名字就列出全部。要新建用 create_workflow。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '工作流名称的一部分，例如 PCT 或鹏城' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: '列出可以拼进工作流的本领：读表、对事项、配收件人、提交审核等，每项都是给非技术人员看的说法。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'lookup_api',
      description: '查阅全部原站接口文档。用 Call 名（如 GetSearchFiles）、ashx 入口或中文主题检索。问一共有多少接口时，query 用「多少接口」，返回的是按入口和 Call 去重后的个数，不是文档篇数。只用于对照，不能据此直接发请求。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Call 名、入口或中文主题' } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: '把用户明确说过、以后还要用的偏好或事实写进长期记忆。不要记密码，不要记一次性的查询结果。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '一句完整的事实，例如：用户习惯先看法律期限' } },
        required: ['text'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: '从长期记忆里找出和这句话有关的事实。不给关键词就返回最近记住的。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '关键词，可空' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_workflow',
      description: '按本领创建一条工作流并保存。本领用中文名，用顿号或逗号分开，例如：读表格、核对事项、谁来收。系统自带的不会被覆盖。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '工作流名字' },
          skills: { type: 'string', description: '要包含的本领，按顺序' },
          summary: { type: 'string', description: '一句说明，可空' }
        },
        required: ['name', 'skills'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_workflow_field',
      description: '修改一条自己创建的工作流里某一栏的值。不能改系统自带的 PCT提醒 和 PCT鹏城专案。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '工作流的完整名字' },
          skill: { type: 'string', description: '本领名字，例如 读表格' },
          field: { type: 'string', description: '栏的名字，例如 我方文号那一列' },
          value: { type: 'string', description: '要写成的内容' }
        },
        required: ['name', 'skill', 'field', 'value'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '按文号、申请号、客户或文件名查出文件，在发文任务里记下一条计划。一次最多 8 个文件。不会提交到 EASY，也不会代点创建发文或提交审核。',
      parameters: {
        type: 'object',
        properties: {
          caseVolume: { type: 'string', description: '我方文号' },
          applicationNo: { type: 'string', description: '申请号' },
          customerName: { type: 'string', description: '客户名称' },
          fileName: { type: 'string', description: '文件名' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_customer',
      description: '读一位客户在插件里的配置和绑定的工作流。连上 EASY 时再读客户名录。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '客户名称' } },
        required: ['name'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'preview_workflow',
      description: '用大白话预览一条工作流的步骤。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '工作流名字' } },
        required: ['name'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'draft_mail',
      description: '用这一轮查到的文件起草主题和正文，并分成几封。占位符由文件填写。不发送，不提交。',
      parameters: {
        type: 'object',
        properties: { customerName: { type: 'string', description: '客户名称，可空，空则用这一轮文件上的客户' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '列出发文任务页里当前登录人的任务。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_history',
      description: '列出记录页里保存的查询。',
      parameters: {
        type: 'object',
        properties: { surface: { type: 'string', description: 'file 或 limit，默认 file' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_reviewers',
      description: '列出审核人，并说明当前登录人能否被选中。不提交审核。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_processes',
      description: '列出流程名单。不开页面。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'AP、EF 或 CO' },
          searchKey: { type: 'string', description: '搜索词，可空' }
        },
        required: ['kind'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_acceptance',
      description: '列出验收页已经记下的只读核对记录。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'readonly_acceptance',
      description: '对一个只读接口做一次验收核对。不发送写请求。',
      parameters: {
        type: 'object',
        properties: {
          call: { type: 'string', description: '只读 Call 名' },
          caseTypeId: { type: 'string', description: '案件类型，可空' },
          mailId: { type: 'string', description: '邮件编号，可空' }
        },
        required: ['call'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'diagnose_mail',
      description: '只读核对一封已经存在的邮件，不写入。',
      parameters: {
        type: 'object',
        properties: { mailId: { type: 'string', description: '邮件编号' } },
        required: ['mailId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'submit_easy',
      description: '按这一轮查到的期限事项，创建发文并提交给当前登录人。写开关关着就不会提交。',
      parameters: {
        type: 'object',
        properties: { caseVolume: { type: 'string', description: '我方文号，可空。空则用这一轮查到的文件文号' } },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_contacts',
      description: '按文号导出案件联系人。文号可空，空则用这一轮查到的文件。',
      parameters: {
        type: 'object',
        properties: { volumes: { type: 'string', description: '文号，多个用空格或逗号分开' } },
        additionalProperties: false
      }
    }
  }
]

export function agentToolSchemas(): ToolSchema[] {
  return SCHEMAS
}

function textArg(args: Record<string, unknown>, key: string, max = 80): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function clip(text: string): string {
  return clipToolResult(text)
}

function forwardedError(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error: unknown }).error === 'string') {
    return (value as { error: string }).error
  }
  if (!isMessage(value)) return 'EASY 没有返回可识别的结果。'
  return null
}

async function searchCases(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const caseVolume = textArg(args, 'caseVolume')
  const applicationNo = textArg(args, 'applicationNo')
  const customerName = textArg(args, 'customerName', 120)
  const fileName = textArg(args, 'fileName', 120)
  if (!caseVolume && !applicationNo && !customerName && !fileName) return '至少给出文号、申请号、客户或文件名中的一项。'
  const query = {
    pageIndex: 1,
    pageSize: 10,
    ...(caseVolume ? { caseVolume } : {}),
    ...(applicationNo ? { applicationNo } : {}),
    ...(customerName ? { customerName } : {}),
    ...(fileName ? { fileName } : {})
  }
  const response = await ctx.forward({ type: MessageType.SearchFiles, payload: { query } })
  const error = forwardedError(response)
  if (error) return error
  if (!isMessage(response) || response.type !== MessageType.SearchFilesResult) return '文件查询没有返回结果。'
  if (!response.payload.ok) return response.payload.error.message
  const data = response.payload.data
  const selected = data.items.map(asSelected).filter((item): item is SelectedPatentFile => item !== null)
  if (selected.length > 0) ctx.rememberFiles(selected)
  const lines = data.items.slice(0, 10).map(item => [item.caseVolume, item.caseName, item.fileName, item.customerName, item.applicationNo].filter(Boolean).join(' | '))
  return clip(`文件查询共 ${data.total} 条。\n${lines.join('\n') || '这一页没有记录。'}`)
}

async function searchDeadlines(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const kind = textArg(args, 'kind') || 'all'
  const allowed = ['all', 'pay', 'suspend', 'abandon', 'recall', 'priority', 'fee']
  if (!allowed.includes(kind)) return '期限页签无效。'
  const caseVolume = textArg(args, 'caseVolume')
  const applicationNo = textArg(args, 'applicationNo')
  const customerName = textArg(args, 'customerName', 120)
  const query = {
    type: kind as 'all',
    pageIndex: 1,
    pageSize: 10,
    ...(caseVolume ? { caseVolume } : {}),
    ...(applicationNo ? { applicationNo } : {}),
    ...(customerName ? { customerName } : {})
  }
  const response = await ctx.forward({ type: MessageType.SearchLimitMonitor, payload: { query } })
  const error = forwardedError(response)
  if (error) return error
  if (!isMessage(response) || response.type !== MessageType.SearchLimitMonitorResult) return '期限监控没有返回结果。'
  if (!response.payload.ok) return response.payload.error.message
  const data = response.payload.data
  const deadlines = data.items
    .filter(item => item.procId && item.caseVolume)
    .map(item => ({ procId: item.procId, caseId: item.caseId, caseVolume: item.caseVolume }))
  if (deadlines.length > 0) ctx.rememberDeadlines(deadlines)
  const lines = data.items.slice(0, 10).map(item =>
    [item.caseVolume, item.ctrlProc, item.customerName, item.intDueDate && `内部 ${item.intDueDate}`, item.cusDueDate && `客户 ${item.cusDueDate}`, item.legalDueDate && `法律 ${item.legalDueDate}`].filter(Boolean).join(' | ')
  )
  return clip(`期限监控共 ${data.total} 条。\n${lines.join('\n') || '这一页没有未结束的事项。'}`)
}

/** 测试和未接线时的空实现。成功句式与正式工具一致，失败句不以成功前缀开头。 */
export function emptyPageTools(): Pick<ToolContext, 'rememberFiles' | 'recentFiles' | 'rememberDeadlines' | 'recentDeadlines' | 'readCustomer' | 'previewWorkflow' | 'draftMail' | 'listTasks' | 'listHistory' | 'listReviewers' | 'listProcesses' | 'listAcceptance' | 'readonlyAcceptance' | 'diagnoseMail' | 'exportContacts' | 'submitEasy'> {
  return {
    rememberFiles() {},
    recentFiles: () => [],
    readCustomer: async () => '没有对上的客户。',
    previewWorkflow: async () => '没有对上的工作流。',
    draftMail: async () => '先查案件，这一轮还没有文件可以起草。',
    listTasks: async () => '发文任务共 0 条。',
    listHistory: async () => '查询记录共 0 条。',
    listReviewers: async () => '审核人共 0 人。这一步没有提交审核。',
    listProcesses: async () => '流程共 0 条。没有打开页面。',
    listAcceptance: async () => '验收共 0 条。',
    readonlyAcceptance: async () => '只读验收没有完成。',
    diagnoseMail: async () => '还没有邮件编号。',
    exportContacts: async () => '还没有文号可以导出联系人。',
    rememberDeadlines() {},
    recentDeadlines: () => [],
    submitEasy: async () => '写开关已关闭，没有提交到 EASY。'
  }
}

export async function executeAgentTool(name: string, rawArguments: string, ctx: ToolContext, memory: AgentMemoryState): Promise<{ text: string; memory: AgentMemoryState }> {
  let args: Record<string, unknown> = {}
  if (rawArguments.trim()) {
    try {
      const parsed = JSON.parse(rawArguments) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
    } catch {
      return { text: '工具参数不是有效 JSON。', memory }
    }
  }
  try {
    if (name === 'connection_status') {
      const snap = ctx.snapshot()
      return { text: snap.connected ? `已连接 ${snap.displayName || '当前登录人'}，站点 ${snap.origin}。` : (snap.message || '尚未连接 EASY。'), memory }
    }
    if (name === 'search_cases') return { text: await searchCases(ctx, args), memory }
    if (name === 'search_deadlines') return { text: await searchDeadlines(ctx, args), memory }
    if (name === 'list_customers') {
      const rows = await ctx.customers()
      if (rows.length === 0) return { text: '当前账号还没有在插件里保存客户。', memory }
      return { text: clip(rows.slice(0, 40).map(row => `${row.name}｜入口 ${row.surface || '未设'}｜工作流 ${row.workflowId || '未设'}`).join('\n')), memory }
    }
    if (name === 'describe_workflows') {
      const nameQuery = textArg(args, 'name', 40).toLowerCase()
      const flows = await ctx.workflows()
      const picked = nameQuery ? flows.filter(flow => flow.label.toLowerCase().includes(nameQuery) || flow.summary.toLowerCase().includes(nameQuery)) : flows
      if (picked.length === 0) return { text: '没有对上的工作流。', memory }
      return {
        text: clip(picked.map(flow => `${flow.label}：${flow.summary}\n${flow.steps.map((step, index) => `${index + 1}. ${step.title} ${step.detail}`).join('\n')}`).join('\n\n')),
        memory
      }
    }
    if (name === 'list_skills') {
      return { text: clip(ctx.skills().map(skill => `${skill.title}：${skill.blurb}。${skill.detail}`).join('\n')), memory }
    }
    if (name === 'remember') {
      const text = textArg(args, 'text', 240)
      if (!text) return { text: '没有可记的内容。', memory }
      const next = rememberFact(memory, text)
      return { text: next === memory ? '这句话已经在长期记忆里。' : `已记住：${text}`, memory: next }
    }
    if (name === 'lookup_api') {
      const query = textArg(args, 'query', 120)
      if (!query) return { text: '请给出 Call 名、入口或中文主题。', memory }
      return { text: clip(ctx.lookupApi(query)), memory }
    }
    if (name === 'recall') {
      const found = searchFacts(memory, textArg(args, 'query', 80))
      return { text: found.length === 0 ? '长期记忆里没有对上的内容。' : found.map(fact => fact.text).join('\n'), memory }
    }
    if (name === 'create_workflow') {
      const title = textArg(args, 'name', 40)
      const skills = textArg(args, 'skills', 400)
      if (!title || !skills) return { text: '要有名字，以及用哪些本领。', memory }
      return { text: await ctx.createWorkflow({ name: title, summary: textArg(args, 'summary', 400), skills }), memory }
    }
    if (name === 'set_workflow_field') {
      const title = textArg(args, 'name', 40)
      const skill = textArg(args, 'skill', 40)
      const field = textArg(args, 'field', 40)
      const value = textArg(args, 'value', 200)
      if (!title || !skill || !field || !value) return { text: '要写明工作流、本领、哪一栏、改成什么。', memory }
      return { text: await ctx.setWorkflowField({ name: title, skill, field, value }), memory }
    }
    if (name === 'create_task') {
      return {
        text: await ctx.createTask({
          caseVolume: textArg(args, 'caseVolume'),
          applicationNo: textArg(args, 'applicationNo'),
          customerName: textArg(args, 'customerName', 120),
          fileName: textArg(args, 'fileName', 120)
        }),
        memory
      }
    }
    if (name === 'read_customer') {
      const title = textArg(args, 'name', 80)
      if (!title) return { text: '要写明客户名称。', memory }
      return { text: await ctx.readCustomer(title), memory }
    }
    if (name === 'preview_workflow') {
      const title = textArg(args, 'name', 40)
      if (!title) return { text: '要写明工作流名字。', memory }
      return { text: await ctx.previewWorkflow(title), memory }
    }
    if (name === 'draft_mail') return { text: await ctx.draftMail(textArg(args, 'customerName', 80)), memory }
    if (name === 'list_tasks') return { text: await ctx.listTasks(), memory }
    if (name === 'list_history') return { text: await ctx.listHistory(textArg(args, 'surface', 16)), memory }
    if (name === 'list_reviewers') return { text: await ctx.listReviewers(), memory }
    if (name === 'list_processes') {
      const kind = textArg(args, 'kind', 8).toUpperCase()
      if (kind !== 'AP' && kind !== 'EF' && kind !== 'CO') return { text: '流程种类要是 AP、EF 或 CO。', memory }
      return { text: await ctx.listProcesses(kind, textArg(args, 'searchKey', 80)), memory }
    }
    if (name === 'list_acceptance') return { text: await ctx.listAcceptance(), memory }
    if (name === 'readonly_acceptance') {
      const call = textArg(args, 'call', 40)
      if (!call) return { text: '要写明只读 Call 名。', memory }
      return { text: await ctx.readonlyAcceptance(call, textArg(args, 'caseTypeId', 80), textArg(args, 'mailId', 40)), memory }
    }
    if (name === 'diagnose_mail') {
      const mailId = textArg(args, 'mailId', 40)
      if (!mailId) return { text: '要写明邮件编号。', memory }
      return { text: await ctx.diagnoseMail(mailId), memory }
    }
    if (name === 'export_contacts') return { text: await ctx.exportContacts(textArg(args, 'volumes', 400)), memory }
    if (name === 'submit_easy') return { text: await ctx.submitEasy(textArg(args, 'caseVolume', 400)), memory }
    return { text: `没有这个工具：${name}`, memory }
  } catch (error) {
    return { text: error instanceof Error ? error.message : '工具没有完成。', memory }
  }
}
