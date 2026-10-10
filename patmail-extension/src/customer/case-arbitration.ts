import { buildIcSearchParams, icCasesFromBody } from '../api/ic-search'
import { isRecord, readClientInfo } from '../api/response-guards'
import type { ApiResult } from '../api/types'
import { loadCaseDemandText, type CaseDemandRow } from '../mail/easy/case-demand'

type Post = (operation: 'icSearch' | 'caseDemand' | 'caseInventor' | 'caseManageInfo', params: URLSearchParams) => Promise<ApiResult<unknown>>

const PAGE_FIELDS: Array<[string, string]> = [
  ['case_name', '案件名称'],
  ['app_no', '申请号'],
  ['apply_type', '申请类型'],
  ['customer_name', '客户名称'],
  ['applicant', '申请人'],
  ['pic_user', '处理人'],
  ['case_remark', '案件备注']
]

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : ''
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 把已经读到的栏收成一段。助手只能在这些栏里选，不能再自己要接口。 */
export function formatCaseFields(input: {
  caseVolume: string
  demands: CaseDemandRow[]
  inventors: string
  page: Array<{ label: string; value: string }>
  unread: string[]
}): string {
  const demands = input.demands.slice(0, 8).map((row, index) => {
    const title = clip(row.title, 80)
    const description = clip(row.description, 180)
    return `${index + 1}. ${clip(row.demandType, 40) || '要求'}｜${title || '无标题'}｜${description || '无描述'}`
  })
  const page = input.page.filter(item => item.value.trim()).slice(0, 8)
  const lines = [
    `案件字段：文号 ${input.caseVolume}`,
    demands.length ? `案件要求：\n${demands.join('\n')}` : '案件要求：没有读到要求。',
    `发明人：${input.inventors.trim() || '没有读到发明人。'}`,
    page.length ? `案件页：\n${page.map(item => `${item.label}：${clip(item.value, 120)}`).join('\n')}` : '案件页：没有读到基本信息。',
    input.unread.length ? `没读到：${input.unread.join('、')}。` : '',
    '只在上面这些栏里选定收件人和抄送。拿不准就问用户。创建发文用现成的提交，不要自己拼接口。'
  ]
  return lines.filter(Boolean).join('\n').slice(0, 8000)
}

/** 著录项目至少读到案件要求、发明人或案件页里的一栏，才允许拿去仲裁。 */
export function caseTextUsable(text: string): boolean {
  if (!text.trim() || /我方文号无效|登录已失效|库里没有这个文号/.test(text)) return false
  if (/案件要求：\n\d/.test(text)) return true
  if (/发明人：(?!没有读到)/.test(text)) return true
  return /案件页：\n/.test(text)
}

function pageFields(data: unknown): Array<{ label: string; value: string }> {
  if (!isRecord(data) || !Array.isArray(data.CaseInfo)) return []
  const row = data.CaseInfo.find(isRecord)
  if (!row) return []
  return PAGE_FIELDS.flatMap(([key, label]) => {
    const value = textField(row, key)
    return value ? [{ label, value }] : []
  })
}

async function inventorNames(post: Post, caseId: string): Promise<{ ok: true; names: string } | { ok: false; message: string }> {
  const names: string[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 5; page += 1) {
    const params = new URLSearchParams()
    params.set('Call', 'GetCaseInventor')
    params.set('apply_id', caseId)
    params.set('pageSize', '10')
    params.set('pageIndex', String(page))
    params.set('_PK', 'inventor_id')
    params.set('searchKey', '')
    params.set('colsel', ';code;inventor_name_cn;seq;inventor_id;')
    params.set('log_pagename', 'CaseManage.aspx')
    const loaded = await post('caseInventor', params)
    if (!loaded.ok) return { ok: false, message: loaded.error.message }
    if (!isRecord(loaded.data) || (loaded.data.TableRows != null && !Array.isArray(loaded.data.TableRows))) {
      return { ok: false, message: '发明人没有读到。' }
    }
    const client = readClientInfo(loaded.data.ClientInfo)
    if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '登录已失效。' }
    const rows = Array.isArray(loaded.data.TableRows) ? loaded.data.TableRows : []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const name = textField(row, 'inventor_name_cn')
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
    if (rows.length < 10) break
  }
  return { ok: true, names: names.join('、') }
}

/**
 * 按我方文号读仲裁要用的栏。顺序和字段都写死：案件查询、要求表、发明人、案件页基本信息。
 * 不创建发文。
 */
export async function loadCaseFields(caseVolume: string, post: Post): Promise<string> {
  const volume = caseVolume.trim()
  if (!volume || volume.length > 80) return '我方文号无效，没有读取案件字段。'
  const params = buildIcSearchParams(volume)
  if (!params.ok) return params.error.message
  const searched = await post('icSearch', params.data)
  if (!searched.ok) return searched.error.message
  const hit = icCasesFromBody(searched.data).find(item => item.caseVolume.replace(/\s/g, '').toUpperCase() === volume.replace(/\s/g, '').toUpperCase())
  if (!hit) return formatCaseFields({ caseVolume: volume, demands: [], inventors: '', page: [], unread: ['库里没有这个文号'] })
  const unread: string[] = []
  const demands = await loadCaseDemandText(hit.caseId, (next) => post('caseDemand', next))
  if (!demands.ok && /登录/.test(demands.error.message)) return demands.error.message
  if (!demands.ok) unread.push('案件要求')
  const inventors = await inventorNames(post, hit.caseId)
  if (!inventors.ok && /登录/.test(inventors.message)) return inventors.message
  if (!inventors.ok) unread.push('发明人')
  const infoParams = new URLSearchParams()
  infoParams.set('Call', 'GetCaseInfo')
  infoParams.set('case_id', hit.caseId)
  infoParams.set('log_pagename', 'CaseManage.aspx')
  const info = await post('caseManageInfo', infoParams)
  if (!info.ok && /登录/.test(info.error.message)) return info.error.message
  if (!info.ok) unread.push('案件页')
  return formatCaseFields({
    caseVolume: volume,
    demands: demands.ok ? demands.data.rows : [],
    inventors: inventors.ok ? inventors.names : '',
    page: info.ok ? pageFields(info.data) : [],
    unread
  })
}
