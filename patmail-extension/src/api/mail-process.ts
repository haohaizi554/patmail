import { isQueryGuid } from '../query/query-validator'
import { businessMessage, isRecord, readClientInfo } from './response-guards'
import { apiError, type ApiResult } from './types'

export interface MailProcessQuery {
  searchKey: string
  pageIndex: number
  pageSize: number
}

export interface MailProcessRow {
  mailId: string
  subject: string
  mailTo: string
  mailType: string
  customerName: string
  ownerName: string
  nodeName: string
  updatedAt: string
  remark: string
  urgency: string
}

export interface MailProcessResult {
  items: MailProcessRow[]
  total: number
  pageIndex: number
  pageSize: number
  totalPages: number
}

const COLSEL = ';undefined;undefined;mail_subject;mailtoname;mail_type_zh_cn;customer_name;cn_name;node_name_zh_cn;update_time;now_remark;urgency_name;'

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

export function buildMailProcessParams(query: MailProcessQuery): ApiResult<URLSearchParams> {
  const searchKey = query.searchKey.trim()
  if (searchKey.length > 200) return apiError('INVALID_QUERY', '搜索词过长。')
  if (!Number.isSafeInteger(query.pageIndex) || query.pageIndex < 1) return apiError('INVALID_QUERY', '页码无效。')
  if (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) return apiError('INVALID_QUERY', '每页条数无效。')
  const params = new URLSearchParams()
  params.set('pageIndex', String(query.pageIndex))
  params.set('pageSize', String(query.pageSize))
  params.set('Call', 'GetProcessByTypeCO')
  params.set('searchKey', searchKey)
  params.set('colsel', COLSEL)
  params.set('_t', String(Date.now()))
  params.set('log_pagename', 'ProcessNew.aspx')
  return { ok: true, data: params }
}

/** 发文流程列表。空搜索是原站打开待办时的写法。没有邮件 GUID 的行仍保留，只是不能打开。 */
export function normalizeMailProcess(response: unknown, query: MailProcessQuery): ApiResult<MailProcessResult> {
  if (!isRecord(response)) return apiError('INVALID_RESPONSE', '发文列表响应不是对象。')
  const client = readClientInfo(response.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  if (client.data.Status !== true || client.data.IsLogin !== true) {
    return apiError('INVALID_RESPONSE', '发文列表缺少明确的登录状态。')
  }
  if (response.TableRows === undefined) return apiError('INVALID_RESPONSE', '发文列表没有返回 TableRows。')
  if (response.TableRows !== null && !Array.isArray(response.TableRows)) {
    return apiError('INVALID_RESPONSE', 'TableRows 类型无效。')
  }
  const items: MailProcessRow[] = []
  for (const row of response.TableRows ?? []) {
    if (!isRecord(row)) return apiError('INVALID_RESPONSE', '发文记录不是对象。')
    const rawId = text(row.obj_id) || text(row.mail_id) || text(row.objid)
    items.push({
      mailId: isQueryGuid(rawId) ? rawId : '',
      subject: text(row.mail_subject),
      mailTo: text(row.mailtoname),
      mailType: text(row.mail_type_zh_cn),
      customerName: text(row.customer_name),
      ownerName: text(row.cn_name),
      nodeName: text(row.node_name_zh_cn),
      updatedAt: text(row.update_time),
      remark: text(row.now_remark),
      urgency: text(row.urgency_name)
    })
  }
  const total = totalOf(response, items.length)
  if (total === null || !Number.isSafeInteger(total)) return apiError('INVALID_RESPONSE', 'TableRowsCount 不是有效非负整数。')
  return {
    ok: true,
    data: {
      items,
      total,
      pageIndex: query.pageIndex,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize)
    }
  }
}
