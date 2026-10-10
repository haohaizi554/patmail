import { apiError, type ApiResult } from '../api/types'

export type PctSendGate = 'open' | 'pending' | 'done'

/** 发文等子流程都已结束，处理事项还没有管制完成日。只给 PCT 相关核对用。 */
export const MAILED_UNFINISHED_REVIEW = '已发文，事项未管制完成日'
/** 这项事项已经完成，下面没有子流程。 */
export const SKIP_SEND_REVIEW = '不用发'

/** 一边是另一边再加一段「-后缀」。用来认出库里文号和表格文号只差放弃复审这类尾巴。 */
export function suffixVariant(left: string, right: string): boolean {
  const a = left.replace(/\s/g, '').toUpperCase()
  const b = right.replace(/\s/g, '').toUpperCase()
  if (!a || !b || a === b) return false
  const long = a.length >= b.length ? a : b
  const short = a.length >= b.length ? b : a
  if (!long.startsWith(short)) return false
  const extra = long.slice(short.length)
  return extra.startsWith('-') && extra.length > 1
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function isCurrent(row: Record<string, unknown>): boolean {
  return text(row.order_by) === '2'
}

/**
 * 发文子流程：当前节点（order_by 为 2）的 node_code 大写后是 END，才算已经审核完成。
 * 还没有发文流程，可以勾选。当前节点不是 END，是待审核。
 * 同一事项下多条发文按 id 分开，有一条没结束就整件待审核。
 */
export function classifyProcSendGate(body: unknown, procId: string): PctSendGate {
  if (!body || typeof body !== 'object') return 'open'
  const eflow = (body as { Eflow?: unknown }).Eflow
  if (!Array.isArray(eflow)) return 'open'
  const wanted = procId.trim().toLowerCase()
  const rows = eflow.filter((row): row is Record<string, unknown> => {
    if (!row || typeof row !== 'object') return false
    const item = row as Record<string, unknown>
    return text(item.eflow_name) === '发文' && text(item.proc_id).toLowerCase() === wanted
  })
  if (!rows.length) return 'open'
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = text(row.id)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  let finished = 0
  for (const group of groups.values()) {
    const current = group.find(isCurrent)
    if (!current || text(current.node_code).toUpperCase() !== 'END') return 'pending'
    finished += 1
  }
  return finished > 0 ? 'done' : 'open'
}

/**
 * 用处理事项名称在 ProcInfo 里对上每一条 proc_id，再逐条看发文子流程。
 * 查到案子不等于还没提交。同名事项有一条已提交或已审完，就不被另一条没有发文的记录盖掉。
 * 对不上名称时不是待审核。
 */
export function gateForProcLabel(body: unknown, procLabel: string): PctSendGate | 'missing' {
  const wanted = procLabel.trim()
  if (!wanted || !body || typeof body !== 'object') return 'missing'
  const info = (body as { ProcInfo?: unknown }).ProcInfo
  if (!Array.isArray(info)) return 'missing'
  let sawPending = false
  let sawDone = false
  let sawOpen = false
  let matched = false
  for (const row of info) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (text(item.ctrl_proc) !== wanted) continue
    const procId = text(item.proc_id)
    if (!procId) continue
    matched = true
    const gate = classifyProcSendGate(body, procId)
    if (gate === 'pending') sawPending = true
    else if (gate === 'done') sawDone = true
    else sawOpen = true
  }
  if (!matched) return 'missing'
  if (sawPending) return 'pending'
  if (sawDone) return 'done'
  return sawOpen ? 'open' : 'missing'
}

function groupsOf(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = text(row.id)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

function subflowsEnded(rows: Record<string, unknown>[]): boolean {
  const groups = groupsOf(rows)
  if (!groups.size) return false
  for (const group of groups.values()) {
    const current = group.find(isCurrent)
    if (!current || text(current.node_code).toUpperCase() !== 'END') return false
  }
  return true
}

/**
 * 这项处理事项下面的子流程当前节点都是结束，并且完成日还是空的。
 * 有一条子流程没结束，或完成日已经填了，就不是这个状态。
 */
export function mailedWithoutFinishDate(body: unknown, procLabel: string): boolean {
  const wanted = procLabel.trim()
  if (!wanted || !body || typeof body !== 'object') return false
  const info = (body as { ProcInfo?: unknown }).ProcInfo
  const eflow = (body as { Eflow?: unknown }).Eflow
  if (!Array.isArray(info)) return false
  const flows = Array.isArray(eflow) ? eflow.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []
  let openFlow = false
  let unfinished = false
  for (const row of info) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (text(item.ctrl_proc) !== wanted) continue
    const procId = text(item.proc_id).toLowerCase()
    if (!procId) continue
    const mine = flows.filter(flow => text(flow.proc_id).toLowerCase() === procId)
    if (!mine.length) continue
    if (!subflowsEnded(mine)) {
      openFlow = true
      continue
    }
    if (!text(item.finish_date)) unfinished = true
  }
  return unfinished && !openFlow
}

function procFinished(item: Record<string, unknown>): boolean {
  if (text(item.finish_date)) return true
  return /完成/.test(text(item.proc_status))
}

/**
 * 对上的处理事项都没有子流程，而且事项已经完成。
 * 还有子流程在走，或完成日和事项状态都空着，就不是不用发。
 */
export function finishedWithoutFlow(body: unknown, procLabel: string): boolean {
  const wanted = procLabel.trim()
  if (!wanted || !body || typeof body !== 'object') return false
  const info = (body as { ProcInfo?: unknown }).ProcInfo
  const eflow = (body as { Eflow?: unknown }).Eflow
  if (!Array.isArray(info)) return false
  const flows = Array.isArray(eflow) ? eflow.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []
  let finished = false
  let matched = false
  for (const row of info) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (text(item.ctrl_proc) !== wanted) continue
    const procId = text(item.proc_id).toLowerCase()
    if (!procId) continue
    matched = true
    const mine = flows.filter(flow => text(flow.proc_id).toLowerCase() === procId)
    if (mine.length) return false
    if (procFinished(item)) finished = true
  }
  return matched && finished
}

/** 这项处理事项下面有没有任意子流程。用来决定要不要换另一个文号再查。 */
export function procHasSubflow(body: unknown, procLabel: string): boolean {
  const wanted = procLabel.trim()
  if (!wanted || !body || typeof body !== 'object') return false
  const info = (body as { ProcInfo?: unknown }).ProcInfo
  const eflow = (body as { Eflow?: unknown }).Eflow
  if (!Array.isArray(info) || !Array.isArray(eflow)) return false
  const flows = eflow.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
  for (const row of info) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (text(item.ctrl_proc) !== wanted) continue
    const procId = text(item.proc_id).toLowerCase()
    if (procId && flows.some(flow => text(flow.proc_id).toLowerCase() === procId)) return true
  }
  return false
}

export interface IcFlowAsk {
  /** 先查的文号。有我方文号时放我方，没有才放客户文号。 */
  caseVolume: string
  procLabel: string
  /**
   * 我方没对上时再查的客户文号，查的是客户文号栏。
   * 表上只有客户文号时，和 caseVolume 填同一个，表示直接查客户文号栏。
   * 两栏本来就是同一个文号时不要填，仍先查我方文号。
   */
  customerVolume?: string
}

export interface IcFlowHit {
  caseVolume: string
  procLabel: string
  found: boolean
  gate: '' | PctSendGate
  /** 子流程都结束了，事项完成日仍是空的。 */
  uncontrolled?: true
  /** 没有子流程，事项已经完成。 */
  skipSend?: true
  /** 表格里的我方文号只是库里文号加了后缀，改成库里的。 */
  correctedOur?: string
  /** 表格里的客户文号只是库里文号加了后缀，改成库里的。 */
  correctedCustomer?: string
  /** 这一件请求没有读成。不是库里没有。 */
  unread?: true
  /** 案子查到了，发文流程这一下没有读成。 */
  statusUnread?: true
}

export function caseBusFlowParams(caseId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'GetCaseBusFlow')
  params.set('case_id', caseId)
  params.set('log_pagename', 'CaseManage.aspx')
  return params
}

/** 只读案件流程图，判断这一件处理事项的发文能不能勾选。 */
export async function loadPctSendGate(
  caseId: string,
  procId: string,
  post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
  signal?: AbortSignal
): Promise<ApiResult<{ gate: PctSendGate }>> {
  const result = await post(caseBusFlowParams(caseId), signal)
  if (!result.ok) return result
  const data = result.data
  if (!data || typeof data !== 'object') return apiError('INVALID_RESPONSE', '案件流程没有返回。')
  const record = data as { Eflow?: unknown; ProcInfo?: unknown }
  if (!Array.isArray(record.Eflow) && !Array.isArray(record.ProcInfo)) {
    return apiError('INVALID_RESPONSE', '案件流程没有返回。')
  }
  return { ok: true, data: { gate: classifyProcSendGate(data, procId) } }
}
