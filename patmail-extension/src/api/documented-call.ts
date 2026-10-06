import { isLiveWriteCall } from '../automation/live-readonly-policy'
import { caseInfoParams } from '../case-contact/query'
import { caseBusFlowParams } from '../customer/pct-flow-status'
import { caseDemandParams } from '../mail/easy/case-demand'

const HANDLER = /^[A-Za-z][A-Za-z0-9]{0,40}\.ashx$/
const CALL = /^[A-Za-z][A-Za-z0-9_]{1,80}$/
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const WRITE = /save|delete|submit|update|insert|remove|create|destroy|drop|mailcustomer|flowsubmit|endemail/i

export function documentedCallAllowed(handler: string, call: string): { ok: true } | { ok: false; reason: string } {
  if (!HANDLER.test(handler)) return { ok: false, reason: '入口名无效，没有发出。' }
  if (!CALL.test(call)) return { ok: false, reason: 'Call 名无效，没有发出。' }
  if (isLiveWriteCall(call) || WRITE.test(call)) return { ok: false, reason: '这个 Call 会改数据，没有发出。创建和提交仍用现成工具。' }
  return { ok: true }
}

export function documentedFields(value: unknown): Record<string, string> | null {
  if (value === undefined) return {}
  let record: unknown = value
  if (typeof record === 'string') {
    try { record = JSON.parse(record) as unknown } catch { return null }
  }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null
  const entries = Object.entries(record)
  if (entries.length > 12) return null
  const fields: Record<string, string> = {}
  for (const [key, item] of entries) {
    if (key === 'Call' || !FIELD.test(key) || /cookie|authorization|password|token/i.test(key)) return null
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return null
    const text = String(item)
    if (text.length > 200) return null
    fields[key] = text
  }
  return fields
}

export function documentedParams(call: string, fields: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', call)
  for (const [key, value] of Object.entries(fields)) params.set(key, value)
  if (!params.get('log_pagename')) params.set('log_pagename', 'CaseManage.aspx')
  return params
}

export interface EasyStep {
  handler: string
  call: string
  fields: Record<string, string>
}

const STEP_REF = /^@\{(\d+)\.([A-Za-z0-9_.]+)\}$/

const RECIPE_NAMES = ['biology', 'case-info', 'case-flow', 'case-demand'] as const

function paramsToFields(params: URLSearchParams): Record<string, string> {
  const fields: Record<string, string> = {}
  params.forEach((value, key) => {
    if (key !== 'Call' && value.length <= 200) fields[key] = value
  })
  return fields
}

/** 固定组合只收案件编号，字段用页面上已经写好的那一套。 */
export function explainEasyArgs(args: Record<string, unknown>): string | null {
  const recipe = typeof args.recipe === 'string' ? args.recipe.trim() : ''
  if (!recipe) return null
  if (!RECIPE_NAMES.includes(recipe as typeof RECIPE_NAMES[number])) {
    return `没有这个固定组合：${recipe}。可以用 ${RECIPE_NAMES.join('、')}。`
  }
  const caseId = typeof args.case_id === 'string' ? args.case_id.trim() : ''
  if (!caseId) return '这个固定组合要填查到的案件编号。'
  if (recipe === 'case-demand' && !caseDemandParams(caseId, 1)) return '案件编号格式不对，没有发出。'
  return null
}

function recipeStep(recipe: string, caseId: string): EasyStep | null {
  if (recipe === 'biology') {
    return {
      handler: 'CFInvoice.ashx',
      call: 'GetBiologyList',
      fields: { case_id: caseId, pageSize: '10', pageIndex: '1', _PK: 'biomaterial_id', searchKey: '', colsel: '' }
    }
  }
  if (recipe === 'case-info') return { handler: 'AgencyAction.ashx', call: 'GetCaseInfo', fields: paramsToFields(caseInfoParams(caseId)) }
  if (recipe === 'case-flow') return { handler: 'CaseInfo.ashx', call: 'GetCaseBusFlow', fields: paramsToFields(caseBusFlowParams(caseId)) }
  if (recipe === 'case-demand') {
    const params = caseDemandParams(caseId, 1)
    if (!params) return null
    return { handler: 'PatentAction.ashx', call: 'GetDemandBuCaseid', fields: paramsToFields(params) }
  }
  return null
}

/** 单步用 handler 和 call。多步用 steps。固定组合用 recipe 加 case_id。后面的字段可以用 @{1.路径} 取前面响应里的值。 */
export function readEasySteps(args: Record<string, unknown>): EasyStep[] | null {
  const recipe = typeof args.recipe === 'string' ? args.recipe.trim() : ''
  if (recipe) {
    const caseId = typeof args.case_id === 'string' ? args.case_id.trim() : ''
    const step = recipeStep(recipe, caseId)
    return step ? [step] : null
  }
  if (Array.isArray(args.steps)) {
    if (args.steps.length === 0 || args.steps.length > 4) return null
    const steps: EasyStep[] = []
    for (const item of args.steps) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
      const row = item as Record<string, unknown>
      const handler = typeof row.handler === 'string' ? row.handler.trim() : ''
      const call = typeof row.call === 'string' ? row.call.trim() : ''
      const fields = documentedFields(row.fields)
      if (!handler || !call || !fields) return null
      steps.push({ handler, call, fields })
    }
    return steps
  }
  const handler = typeof args.handler === 'string' ? args.handler.trim() : ''
  const call = typeof args.call === 'string' ? args.call.trim() : ''
  if (!handler || !call) return null
  const fields = documentedFields(args.fields)
  if (!fields) return null
  return [{ handler, call, fields }]
}

function pickPath(data: unknown, path: string): unknown {
  let current = data
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index) || part !== String(index)) return undefined
      current = current[index]
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** 把 @{步骤.路径} 换成前面某一步响应里的字符串。对不上就停，不发这一步。 */
export function applyEasyRefs(fields: Record<string, string>, earlier: readonly unknown[]): { ok: true; fields: Record<string, string> } | { ok: false; reason: string } {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    const ref = STEP_REF.exec(value.trim())
    if (!ref) {
      next[key] = value
      continue
    }
    const index = Number(ref[1]) - 1
    if (index < 0 || index >= earlier.length) return { ok: false, reason: `${key} 引用了还没有的第 ${ref[1]} 步，这一步没有发出。` }
    const found = pickPath(earlier[index], ref[2] ?? '')
    if (typeof found !== 'string' && typeof found !== 'number' && typeof found !== 'boolean') {
      return { ok: false, reason: `${key} 没有从第 ${ref[1]} 步对上 ${ref[2]}，这一步没有发出。` }
    }
    next[key] = String(found)
  }
  return { ok: true, fields: next }
}

export function payloadFromSummary(text: string): unknown | null {
  const marker = '已用当前登录会话调用，没有改数据。\n'
  if (!text.startsWith(marker)) return null
  const body = text.slice(marker.length)
  if (!body || body.endsWith('…')) return null
  try { return JSON.parse(body) as unknown } catch { return null }
}

/** 把实时响应收成助手能读的一段。不包含登录凭据。 */
export function summarizeEasyPayload(data: unknown): string {
  let json = ''
  try { json = JSON.stringify(data) ?? '' } catch { json = '' }
  const body = json.length > 1800 ? `${json.slice(0, 1800)}…` : json
  return `已用当前登录会话调用，没有改数据。\n${body || '接口返回了空内容。'}`
}
