import { canonicalArgs } from './turn-policy'

/** 模型这一轮自己拆开的一步。工具名必须是现有工具。args 是这一步要传的参数。 */
export interface WorkStep {
  title: string
  tool: string
  args?: string
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stepArgs(value: unknown): string {
  if (typeof value === 'string') return canonicalArgs(value.slice(0, 500))
  if (typeof value === 'object' && value !== null) {
    try {
      return canonicalArgs(JSON.stringify(value).slice(0, 500))
    } catch {
      return ''
    }
  }
  return ''
}

/** 读出 2 到 6 步。写不清、工具名不存在、或拿计划本身当一步，就不采用。 */
export function readWorkPlan(args: Record<string, unknown>, allowed: ReadonlySet<string>): WorkStep[] | null {
  const raw = args.steps
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) return null
  const steps: WorkStep[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    const title = clip(row.title, 40)
    const tool = clip(row.tool, 40)
    if (!title || !tool || tool === 'plan_work' || !allowed.has(tool)) return null
    const args = stepArgs(row.args)
    steps.push({ title, tool, ...(args ? { args } : {}) })
  }
  return steps
}

export function formatWorkPlan(steps: readonly WorkStep[]): string {
  const lines = steps.map((step, index) => `${index + 1}. ${step.title}（${step.tool}）`)
  return `计划已写下，共 ${steps.length} 步。\n${lines.join('\n')}`
}

function sameStep(step: WorkStep, trace: { name: string; ok: boolean; args?: string }): boolean {
  if (!trace.ok || step.tool !== trace.name) return false
  if (!step.args) return true
  return step.args === (trace.args ?? '')
}

/** 按顺序对上成功的工具。参数写了就要对上。失败或做了别的工具，不把后面的步骤勾掉。 */
export function remainingWork(steps: readonly WorkStep[], traces: readonly { name: string; ok: boolean; args?: string }[]): WorkStep[] {
  const left = steps.slice()
  for (const trace of traces) {
    if (!sameStep(left[0] ?? { title: '', tool: '' }, trace)) continue
    left.shift()
  }
  return left
}

/** 采用这一批里最后一次写成功的计划。 */
export function planFromCalls(
  calls: readonly { function: { name: string; arguments: string } }[],
  traces: readonly { name: string; args: string; ok: boolean }[],
  allowed: ReadonlySet<string>
): WorkStep[] | null {
  const call = [...calls].reverse().find(item => item.function.name === 'plan_work')
  if (!call) return null
  const args = canonicalArgs(call.function.arguments)
  const trace = [...traces].reverse().find(item => item.name === 'plan_work' && item.args === args)
  if (!trace?.ok) return null
  try {
    const parsed = JSON.parse(call.function.arguments) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return readWorkPlan(parsed as Record<string, unknown>, allowed)
  } catch {
    return null
  }
}
