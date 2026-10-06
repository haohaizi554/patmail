import { SKILLS } from '../workflow/skills'

export type SlashGroup = '指令' | '去办' | '本领'
export type SlashLocal = 'help' | 'clear' | 'memory' | 'compact'

export interface SlashCommand {
  name: string
  aliases: readonly string[]
  group: SlashGroup
  description: string
  argumentHint: string
  args: 'none' | 'optional' | 'required'
  local?: SlashLocal
  guide?: (args: string) => string
}

export type SlashResolution =
  | { kind: 'text' }
  | { kind: 'skill'; name: string; display: string; guidance: string }
  | { kind: 'local'; local: SlashLocal; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'need-args'; name: string; message: string }

function told(instruction: string, args: string, empty: string): string {
  return `${instruction}\n${args ? `用户补充：${args}` : empty}`
}

const ACTIONS: SlashCommand[] = [
  {
    name: '帮助',
    aliases: ['help'],
    group: '指令',
    description: '列出可以点的技能',
    argumentHint: '',
    args: 'none',
    local: 'help'
  },
  {
    name: '清空',
    aliases: ['clear'],
    group: '指令',
    description: '清空这段对话，长期记忆还在',
    argumentHint: '',
    args: 'none',
    local: 'clear'
  },
  {
    name: '记忆',
    aliases: ['memory'],
    group: '指令',
    description: '看看长期记住了什么',
    argumentHint: '',
    args: 'none',
    local: 'memory'
  },
  {
    name: '压缩',
    aliases: ['compact'],
    group: '指令',
    description: '把更早的对话收成原文摘录',
    argumentHint: '',
    args: 'none',
    local: 'compact'
  },
  {
    name: '连接',
    aliases: [],
    group: '去办',
    description: '看现在连上 EASY 没有',
    argumentHint: '',
    args: 'none',
    guide: () => '这是点名技能「连接」。只调用 connection_status，用大白话说连上没有、登录人是谁。没连上就告诉用户打开已经登录的 EASY 页面，然后重新打开工作台。'
  },
  {
    name: '查案件',
    aliases: [],
    group: '去办',
    description: '按文号、申请号、客户或文件名查文件',
    argumentHint: '文号、客户或文件名',
    args: 'required',
    guide: args => told(
      '这是点名技能「查案件」。先调用 connection_status。已经连上再用 search_cases，从补充里取文号、申请号、客户或文件名。先给结论，再列依据。不要编造。',
      args,
      ''
    )
  },
  {
    name: '查期限',
    aliases: [],
    group: '去办',
    description: '查还没结束的期限和事项',
    argumentHint: '文号或客户，可空',
    args: 'optional',
    guide: args => told(
      '这是点名技能「查期限」。先调用 connection_status。已经连上再用 search_deadlines。页签不确定就用 all。先给还没结束的事项和内部、客户、法律期限。',
      args,
      '用户没有写条件，查最近一页未结束事项即可。'
    )
  },
  {
    name: '客户',
    aliases: [],
    group: '去办',
    description: '这位登录人在插件里配过的客户',
    argumentHint: '',
    args: 'none',
    guide: () => '这是点名技能「客户」。调用 list_customers，按客户说明入口和工作流。没有客户就告诉用户去客户管理里配。'
  },
  {
    name: '工作流',
    aliases: [],
    group: '去办',
    description: '已封装的发文流程',
    argumentHint: '名称的一部分，可空',
    args: 'optional',
    guide: args => told(
      '这是点名技能「工作流」。调用 describe_workflows。有名称就只讲对上的那条，没有就列出全部。按步骤用大白话说要准备什么。不要代点创建发文或提交审核。',
      args,
      '用户没有写名称，列出全部工作流。'
    )
  },
  {
    name: '接口',
    aliases: [],
    group: '去办',
    description: '按 Call 名或中文主题查接口文档',
    argumentHint: 'Call 名或中文主题',
    args: 'required',
    guide: args => told(
      '这是点名技能「接口」。调用 lookup_api，用用户补充作为检索词。先说明查到的字段和调用方式。文档不是已经发出的请求，真正查询仍用现有工具。',
      args,
      ''
    )
  },
  {
    name: '记住',
    aliases: [],
    group: '去办',
    description: '把一句以后还要用的事实记下来',
    argumentHint: '要记的那句话',
    args: 'required',
    guide: args => told(
      '这是点名技能「记住」。调用 remember，把用户补充原句记进长期记忆。不要改写成另一件事，不要记密码。记完用一句话确认。',
      args,
      ''
    )
  },
  {
    name: '建工作流',
    aliases: [],
    group: '去办',
    description: '按本领创建一条工作流',
    argumentHint: '名字，以及要包含的步骤',
    args: 'required',
    guide: args => told(
      '这是点名技能「建工作流」。调用 create_workflow。从补充里取出名字和本领。本领用这些名字：从哪里开始、读表格、核对事项、对上要发的信、几件合成一封、谁来收、从哪个邮箱发、谁来看一眼、再查一遍并记下。缺名字或没说步骤就先问。创建后说明可以在工作流页面看到。不要代点提交发文。',
      args,
      ''
    )
  },
  {
    name: '建任务',
    aliases: [],
    group: '去办',
    description: '按文号或客户创建一条发文任务',
    argumentHint: '文号、客户或文件名',
    args: 'required',
    guide: args => told(
      '这是点名技能「建任务」。先调用 connection_status。已经连上再调用 create_task，条件从补充里取。创建后说明任务在发文任务里，这一步没有提交到 EASY，也没有代点创建发文。',
      args,
      ''
    )
  }
]

const DRAFT_SKILLS = new Set(['对上要发的信', '几件合成一封', '谁来收'])

const WORKFLOW_COMMANDS: SlashCommand[] = SKILLS.map(skill => ({
  name: skill.title,
  aliases: [],
  group: '本领' as const,
  description: skill.blurb,
  argumentHint: '补充说明，可空',
  args: 'optional' as const,
  guide: (args: string) => told(
    DRAFT_SKILLS.has(skill.title)
      ? `这是工作流本领「${skill.title}」。先查到文件，再调用 draft_mail。占位符由查到的文件填写。不要代点创建发文或提交审核。`
      : `这是工作流本领「${skill.title}」。${skill.blurb}。${skill.detail} 可以调用 list_skills 核对原文。用大白话说明要准备什么、在哪一步用。不要改配置，不要代点创建发文或提交审核。`,
    args,
    DRAFT_SKILLS.has(skill.title) ? '用户没有写补充，就用这一轮已经查到的文件起草。' : '用户没有写补充，就说明这个本领本身。'
  )
}))

export const SLASH_COMMANDS: readonly SlashCommand[] = [...ACTIONS, ...WORKFLOW_COMMANDS]

const TAKEN = new Set<string>()
for (const command of SLASH_COMMANDS) {
  for (const key of [command.name, ...command.aliases]) {
    const folded = key.toLowerCase()
    if (TAKEN.has(folded)) throw new Error(`重复的技能名：${key}`)
    TAKEN.add(folded)
  }
}

function fold(value: string): string {
  return value.trim().toLowerCase()
}

export function findCommand(token: string): SlashCommand | null {
  const key = fold(token)
  if (!key) return null
  return SLASH_COMMANDS.find(command => fold(command.name) === key || command.aliases.some(alias => fold(alias) === key)) ?? null
}

/** 输入框还停在技能名上时返回 `/` 后面的字；已经在写参数就返回 null。 */
export function slashToken(draft: string): string | null {
  if (!draft.startsWith('/')) return null
  if (/\s/.test(draft)) return null
  return draft.slice(1)
}

export function filterCommands(query: string): SlashCommand[] {
  const needle = fold(query)
  if (!needle) return [...SLASH_COMMANDS]
  const matches = (command: SlashCommand, test: (value: string) => boolean): boolean =>
    test(command.name.toLowerCase()) || command.aliases.some(alias => test(alias.toLowerCase()))
  const prefixed = SLASH_COMMANDS.filter(command => matches(command, value => value.startsWith(needle)))
  if (prefixed.length > 0) return prefixed
  return SLASH_COMMANDS.filter(command => matches(command, value => value.includes(needle)))
}

export function helpText(): string {
  const lines = ['输入 / 弹出技能。方向键选择，Enter 使用，Esc 先收起菜单。', '']
  for (const group of ['指令', '去办', '本领'] as const) {
    lines.push(group)
    for (const command of SLASH_COMMANDS.filter(item => item.group === group)) {
      const hint = command.argumentHint ? ` ${command.argumentHint}` : ''
      lines.push(`/${command.name}${hint} — ${command.description}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

/** 把输入分成普通话、点名技能，或当场处理的指令。 */
export function resolveSlash(input: string): SlashResolution {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return { kind: 'text' }
  const body = trimmed.slice(1).trim()
  if (!body) return { kind: 'unknown', message: '在 / 后面接技能名。再输入 / 可以查看全部。' }
  const matched = body.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  const token = matched?.[1] ?? ''
  const args = (matched?.[2] ?? '').trim()
  const command = findCommand(token)
  if (!command) return { kind: 'unknown', message: `没有「/${token}」这个技能。输入 / 查看可以点的。` }
  if (command.local === 'help') return { kind: 'local', local: 'help', message: helpText() }
  if (command.local === 'clear') return { kind: 'local', local: 'clear', message: '这段对话已清空，长期记忆还在。' }
  if (command.local === 'memory') return { kind: 'local', local: 'memory', message: '' }
  if (command.local === 'compact') return { kind: 'local', local: 'compact', message: '' }
  if (command.args === 'required' && !args) {
    return { kind: 'need-args', name: command.name, message: `/${command.name} 还要补上：${command.argumentHint}` }
  }
  const guidance = command.guide?.(args)
  if (!guidance) return { kind: 'unknown', message: `没有「/${token}」这个技能。输入 / 查看可以点的。` }
  return {
    kind: 'skill',
    name: command.name,
    display: args ? `/${command.name} ${args}` : `/${command.name}`,
    guidance
  }
}
