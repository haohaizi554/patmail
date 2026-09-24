import { isQueryGuid } from '../../query/query-validator'
import { buildFileTypeTree } from '../../schema/file-type-tree'
import { apiError, type ApiResult } from '../types'
import type { EasyTransport } from '../transport'
import {
  adaptApplyType, adaptBranchDept, adaptBussType, adaptCaseStatus, adaptCaseType, adaptCountry,
  adaptCtrlProc, adaptCustomerStatus, adaptDictionaryValue, adaptFieldColumns, adaptFlowProcStatus,
  adaptListColumns, adaptProcStatus
} from './adapters'
import { DictionaryCache } from './cache'
import { readDictionaryBody, responseKeyNames } from './guards'
import type {
  BasicDataSnapshot, DictionarySnapshot, FieldColumnSnapshot, FileTypeTreeSnapshot, FlowDataSnapshot, ListColumnSnapshot
} from './types'

const PAGE = 'FileSearch.aspx'
const FILE_SEARCH_COLUMNS = 'CaseInfo.ashx_GetSearchFiles'

function params(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields)
}

export class DictionaryService {
  readonly cache: DictionaryCache

  constructor(private readonly transport: EasyTransport, cache?: DictionaryCache) {
    this.cache = cache ?? new DictionaryCache(10 * 60 * 1000)
  }

  invalidate(userKey: string): void {
    this.cache.invalidateUser(userKey)
  }

  loadBasic(userKey: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<BasicDataSnapshot>> {
    return this.cache.load(this.cache.basicKey(userKey), force, async () => {
      const response = await this.transport.post('basicData', params({ Call: 'IPGetBasicData', log_pagename: PAGE }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      const data = body.data
      return { ok: true, data: {
        kind: 'basic',
        responseKeys: responseKeyNames(data),
        dictionaries: {
          caseType: adaptCaseType(data.CaseType),
          country: adaptCountry(data.Country),
          caseStatus: adaptCaseStatus(data.CaseStatus),
          applyType: adaptApplyType(data.ApplyType),
          bussType: adaptBussType(data.BussType),
          customerStatus: adaptCustomerStatus(data.customer_status),
          ctrlProc: adaptCtrlProc(data.CtrlProc),
          procStatus: adaptProcStatus(data.ProcStatus),
          caseDirection: adaptDictionaryValue('caseDirection', data.Case_direction),
          caseBranchDept: adaptBranchDept(data.CaseBranchDept)
        }
      } }
    })
  }

  loadFlow(userKey: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<FlowDataSnapshot>> {
    return this.cache.load(this.cache.flowKey(userKey), force, async () => {
      const response = await this.transport.post('flowDirection', params({ Call: 'GetFlowdirection', log_pagename: PAGE }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      const data = body.data
      return { ok: true, data: {
        kind: 'flow',
        responseKeys: responseKeyNames(data),
        dictionaries: {
          fileStatus: adaptDictionaryValue('fileStatus', data.FileStatus),
          caseBranchDept: adaptBranchDept(data.CaseBranchDept),
          procStatus: adaptFlowProcStatus(data.ProcStatus),
          caseDirection: adaptDictionaryValue('caseDirection', data.Case_direction),
          downloadFileName: adaptDictionaryValue('downloadFileName', data.DownLoadFileName)
        }
      } }
    })
  }

  loadFileTypes(userKey: string, caseTypeId: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<FileTypeTreeSnapshot>> {
    const caseType = caseTypeId.trim()
    if (!isQueryGuid(caseType)) return Promise.resolve(apiError('INVALID_QUERY', '案件类型必须是内部 ID。'))
    return this.cache.load(this.cache.fileTypeKey(userKey, caseType), force, async () => {
      const response = await this.transport.post('fileTypeTree', params({
        Call: 'LoadFileTypeByCaseType', official: '1', case_type: caseType, file_type: '', log_pagename: PAGE
      }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      const raw = body.data.FileType
      if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
        return apiError('INVALID_RESPONSE', '文件描述响应不是数组。')
      }
      const built = buildFileTypeTree(Array.isArray(raw) ? raw : [])
      return { ok: true, data: { kind: 'fileType', caseTypeId: caseType, ...built } }
    })
  }

  loadFieldColumns(userKey: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<FieldColumnSnapshot>> {
    return this.cache.load(this.cache.fieldColumnKey(userKey), force, async () => {
      const response = await this.transport.post('fieldColumn', params({ Call: 'GetFieldColumn', log_pagename: PAGE }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      if (body.data.fieldColumn === undefined) return apiError('INVALID_RESPONSE', '自定义栏位响应缺少 fieldColumn。')
      const adapted = adaptFieldColumns(body.data.fieldColumn)
      return { ok: true, data: { kind: 'fieldColumn', columns: adapted.columns, warnings: adapted.warnings } }
    })
  }

  loadListColumns(userKey: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<ListColumnSnapshot>> {
    return this.cache.load(this.cache.listColumnKey(userKey), force, async () => {
      const response = await this.transport.post('listColumn', params({
        Call: 'LoadListColumn', belong_key: FILE_SEARCH_COLUMNS, log_pagename: PAGE
      }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      if (body.data.show_column === undefined) return apiError('INVALID_RESPONSE', '列表列响应缺少 show_column。')
      const adapted = adaptListColumns(body.data.show_column)
      return { ok: true, data: { kind: 'listColumn', ...adapted } }
    })
  }

  load(kind: DictionarySnapshot['kind'], userKey: string, force: boolean, caseTypeId = '', signal?: AbortSignal): Promise<ApiResult<DictionarySnapshot>> {
    if (kind === 'basic') return this.loadBasic(userKey, force, signal)
    if (kind === 'flow') return this.loadFlow(userKey, force, signal)
    if (kind === 'fileType') return this.loadFileTypes(userKey, caseTypeId, force, signal)
    if (kind === 'fieldColumn') return this.loadFieldColumns(userKey, force, signal)
    return this.loadListColumns(userKey, force, signal)
  }
}
