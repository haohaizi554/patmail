import { apiError, type ApiResult } from '../api/types'

export type PctSendGate = 'open' | 'pending' | 'done'

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

export interface IcFlowAsk {
  caseVolume: string
  procLabel: string
}

export interface IcFlowHit {
  caseVolume: string
  procLabel: string
  found: boolean
  gate: '' | PctSendGate
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
