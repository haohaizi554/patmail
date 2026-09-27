import type { LimitMonitorQuery } from './limit-monitor-params'
import type { LimitMonitorResult, LimitMonitorRow } from './limit-monitor-types'
import { businessMessage, isRecord, readClientInfo } from './response-guards'
import { apiError, type ApiResult } from './types'

const TEXT_FIELDS = {
  case_id: 'caseId',
  case_volume: 'caseVolume',
  case_name: 'caseName',
  ctrl_proc: 'ctrlProc',
  customer_name: 'customerName',
  app_no: 'appNo',
  doc_date: 'docDate',
  int_due_date: 'intDueDate',
  cus_due_date: 'cusDueDate',
  legal_due_date: 'legalDueDate'
} as const

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function totalOf(response: Record<string, unknown>, itemCount: number): number | null {
  const raw = response.TableRowsCount
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw
  if (raw === undefined || raw === null || raw === '') return itemCount
  return null
}

/** 已登录且 Status 为真时，Result=false 不能单独当成失败。没有 TableRows 才是这次查询没有列表。 */
export function normalizeLimitMonitor(response: unknown, query: LimitMonitorQuery): ApiResult<LimitMonitorResult> {
  if (!isRecord(response)) return apiError('INVALID_RESPONSE', '期限监控响应不是对象。')
  const client = readClientInfo(response.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  if (client.data.Status !== true || client.data.IsLogin !== true) {
    return apiError('INVALID_RESPONSE', '期限监控缺少明确的登录状态。')
  }
  if (response.TableRows === undefined) {
    return apiError('INVALID_RESPONSE', '期限监控没有返回列表。打开页面的首查不是查询结果。')
  }
  if (response.TableRows !== null && !Array.isArray(response.TableRows)) {
    return apiError('INVALID_RESPONSE', 'TableRows 类型无效。')
  }
  const items: LimitMonitorRow[] = []
  for (const row of response.TableRows ?? []) {
    if (!isRecord(row)) return apiError('INVALID_RESPONSE', '期限记录不是对象。')
    const procId = text(row.proc_id)
    if (!procId) return apiError('INVALID_RESPONSE', '期限记录缺少处理事项 ID。')
    const item: LimitMonitorRow = {
      procId,
      caseId: '',
      caseVolume: '',
      caseName: '',
      ctrlProc: '',
      customerName: '',
      appNo: '',
      docDate: '',
      intDueDate: '',
      cusDueDate: '',
      legalDueDate: ''
    }
    for (const source of Object.keys(TEXT_FIELDS) as Array<keyof typeof TEXT_FIELDS>) {
      const value = text(row[source])
      if (value) item[TEXT_FIELDS[source]] = value
    }
    items.push(item)
  }
  const total = totalOf(response, items.length)
  if (total === null || !Number.isSafeInteger(total)) return apiError('INVALID_RESPONSE', 'TableRowsCount 不是有效非负整数。')
  return { ok: true, data: {
    items,
    total,
    pageIndex: query.pageIndex,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize)
  } }
}
