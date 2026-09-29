import type { FileSearchQuery } from './file-search-params'
import type { FileSearchResult } from './file-search-types'
import { businessMessage, isRecord, readClientInfo } from './response-guards'
import { apiError, type ApiResult } from './types'

const OPTIONAL_FIELDS = {
  file_no: 'fileNo',
  file_desc: 'fileDescription',
  file_status: 'fileStatus',
  file_type: 'fileType',
  case_id: 'caseId',
  case_name: 'caseName',
  case_volume: 'caseVolume',
  case_volume_customer: 'customerVolume',
  app_no: 'applicationNo',
  apply_type: 'applicationType',
  customer_name: 'customerName',
  upload_time: 'uploadTime',
  post_date: 'officialPostDate'
} as const

/** 外部响应必须先确认业务状态，才允许解释 TableRows。 */
export function normalizeFileSearch(response: unknown, query: FileSearchQuery): ApiResult<FileSearchResult> {
  if (!isRecord(response)) return apiError('INVALID_RESPONSE', '文件查询响应不是对象。')
  const client = readClientInfo(response.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效。')
  if (client.data.Status === false || client.data.Result === false) {
    return apiError('BUSINESS_ERROR', businessMessage(client.data))
  }
  if (client.data.IsLogin !== true || client.data.Status !== true || client.data.Result !== true) {
    return apiError('INVALID_RESPONSE', '文件查询缺少明确的成功状态。')
  }
  if (response.TableRows !== null && !Array.isArray(response.TableRows)) {
    return apiError('INVALID_RESPONSE', 'TableRows 类型无效。')
  }
  const totalText = response.TableRowsCount
  if (typeof totalText !== 'string' || !/^\d+$/.test(totalText) ||
      !Number.isSafeInteger(Number(totalText))) {
    return apiError('INVALID_RESPONSE', 'TableRowsCount 不是有效非负整数。')
  }
  const items: FileSearchResult['items'] = []
  for (const row of response.TableRows ?? []) {
    if (!isRecord(row) || typeof row.file_id !== 'string' || !row.file_id.trim() ||
        typeof row.file_name !== 'string' || !row.file_name.trim()) {
      return apiError('INVALID_RESPONSE', '文件记录缺少必要标识或名称。')
    }
    const file: FileSearchResult['items'][number] = {
      fileId: row.file_id.trim(),
      fileName: row.file_name.trim()
    }
    for (const [source, target] of Object.entries(OPTIONAL_FIELDS)) {
      const value = row[source]
      if (value === null || value === undefined || value === '') continue
      if (typeof value !== 'string') return apiError('INVALID_RESPONSE', `文件字段 ${source} 类型无效。`)
      Object.assign(file, { [target]: value.trim() })
    }
    items.push(file)
  }
  const total = Number(totalText)
  return { ok: true, data: {
    items, total, pageIndex: query.pageIndex, pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize)
  } }
}
