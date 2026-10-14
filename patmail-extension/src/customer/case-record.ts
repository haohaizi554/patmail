import type { EasyOperation } from '../api/transport'
import { isRecord, readClientInfo } from '../api/response-guards'
import type { ApiResult } from '../api/types'
import { isQueryGuid } from '../query/query-validator'

type Post = (operation: 'casePageDemand' | 'caseInventor' | 'caseRecordContact' | 'caseManageInfo', params: URLSearchParams) => Promise<ApiResult<unknown>>

export interface CaseRecordBrief {
  customerInfo: string
  recordInfo: string
}

/** 带回页面的客户要求和著录项目。再长整批核对结果会被消息校验丢掉，页面就把这一批都标成没查成。 */
const TEXT_LIMIT = 4000

function textField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value) && Array.isArray(value.TableRows)) return value.TableRows.filter(isRecord)
  return []
}

function plainText(value: string): string {
  let text = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
    if (next === text) break
    text = next
  }
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function clip(value: string): string {
  const text = plainText(value)
  if (text.length <= TEXT_LIMIT) return text
  return `${text.slice(0, TEXT_LIMIT - 1)}…`
}

function demandLines(data: unknown): string[] {
  if (!isRecord(data)) return []
  return rowsOf(data.CustomerDemand).flatMap(row => {
    const line = [
      textField(row, ['demand_type', 'demand_type_zh_cn']),
      textField(row, ['demand_name', 'title']),
      textField(row, ['demand_desc', 'remark'])
    ].filter(Boolean).join('｜')
    return line ? [line] : []
  }).slice(0, 8)
}

function inventorLine(data: unknown): string {
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rowsOf(isRecord(data) ? data.TableRows : null)) {
    const name = textField(row, ['inventor_name_cn', 'inventor_name', 'cn_name'])
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= 12) break
  }
  return names.join('、')
}

function contactLines(data: unknown): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const row of rowsOf(isRecord(data) ? data.TableRows : null)) {
    const name = textField(row, ['contact_name', 'cn_name'])
    if (!name || seen.has(name)) continue
    seen.add(name)
    const role = textField(row, ['contact_type', 'contact_type_zh_cn'])
    const email = textField(row, ['email'])
    lines.push([name, role, email].filter(Boolean).join('｜'))
    if (lines.length >= 20) break
  }
  return lines
}

/** 客户要求写成仲裁用的客户信息。空表返回空串。 */
export function formatCustomerInfo(data: unknown): string {
  const lines = demandLines(data)
  if (!lines.length) return ''
  return clip(`客户要求：\n${lines.join('\n')}`)
}

/** 发明人、申请人、案件备注和案件联系人写成著录项目。都空则返回空串。 */
export function formatRecordInfo(inventors: unknown, contacts: unknown, page?: { applicant?: string; remark?: string }): string {
  const names = inventorLine(inventors)
  const people = contactLines(contacts)
  const applicant = page?.applicant?.trim() ?? ''
  const remark = page?.remark?.trim() ?? ''
  if (!names && !people.length && !applicant && !remark) return ''
  const lines = [
    applicant ? `申请人：${applicant}` : '',
    remark ? `案件备注：${remark}` : '',
    `发明人：${names || '没有读到发明人。'}`,
    people.length ? `客户联系人：\n${people.join('\n')}` : '客户联系人：没有读到客户联系人。'
  ].filter(Boolean)
  return clip(lines.join('\n'))
}

function caseParams(call: string, caseId: string, extra: Record<string, string>): URLSearchParams | null {
  if (!isQueryGuid(caseId)) return null
  const params = new URLSearchParams()
  params.set('Call', call)
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  params.set('log_pagename', 'CaseManage.aspx')
  return params
}

async function readOnce(post: Post, operation: 'casePageDemand' | 'caseInventor' | 'caseRecordContact' | 'caseManageInfo', params: URLSearchParams | null): Promise<ApiResult<unknown> | 'skip'> {
  if (!params) return 'skip'
  return post(operation, params)
}

/**
 * 用核对时已经找到的案件编号读客户要求和著录项目。
 * 不重新做案件查询。登录失效交给调用方停下整批；某一栏没读到就留空。
 */
export async function loadCaseRecord(caseId: string, post: Post): Promise<CaseRecordBrief | 'login'> {
  const demandParams = caseParams('GetCaseDemand', caseId, { case_id: caseId })
  const inventorParams = caseParams('GetCaseInventor', caseId, {
    apply_id: caseId,
    pageSize: '10',
    pageIndex: '1',
    _PK: 'inventor_id',
    searchKey: '',
    colsel: ';code;inventor_name_cn;seq;inventor_id;'
  })
  const contactParams = caseParams('GetCaseContact', caseId, {
    id: caseId,
    pageSize: '10',
    pageIndex: '1',
    _PK: 'contact_id',
    searchKey: '',
    colsel: ';contact_name;contact_type;email;contact_id;'
  })
  const demand = await readOnce(post, 'casePageDemand', demandParams)
  if (demand !== 'skip' && !demand.ok && /登录/.test(demand.error.message)) return 'login'
  const inventors = await readOnce(post, 'caseInventor', inventorParams)
  if (inventors !== 'skip' && !inventors.ok && /登录/.test(inventors.error.message)) return 'login'
  const contacts = await readOnce(post, 'caseRecordContact', contactParams)
  if (contacts !== 'skip' && !contacts.ok && /登录/.test(contacts.error.message)) return 'login'
  const infoParams = caseParams('GetCaseInfo', caseId, { case_id: caseId })
  const info = await readOnce(post, 'caseManageInfo', infoParams)
  if (info !== 'skip' && !info.ok && /登录/.test(info.error.message)) return 'login'
  const demandData = demand !== 'skip' && demand.ok ? demand.data : null
  const inventorData = inventors !== 'skip' && inventors.ok ? inventors.data : null
  const contactData = contacts !== 'skip' && contacts.ok ? contacts.data : null
  const infoData = info !== 'skip' && info.ok ? info.data : null
  for (const data of [demandData, inventorData, contactData, infoData]) {
    if (!isRecord(data)) continue
    const client = readClientInfo(data.ClientInfo)
    if (client.ok && client.data.IsLogin === false) return 'login'
  }
  const caseRow = isRecord(infoData) && Array.isArray(infoData.CaseInfo) ? infoData.CaseInfo.find(isRecord) : undefined
  return {
    customerInfo: formatCustomerInfo(demandData),
    recordInfo: formatRecordInfo(inventorData, contactData, {
      applicant: caseRow ? textField(caseRow, ['applicant']) : '',
      remark: caseRow ? textField(caseRow, ['case_remark']) : ''
    })
  }
}

export type CaseRecordOperation = Extract<EasyOperation, 'casePageDemand' | 'caseInventor' | 'caseRecordContact' | 'caseManageInfo'>
