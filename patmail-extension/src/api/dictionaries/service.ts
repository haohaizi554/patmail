import { CURRENT_ENVIRONMENT } from '../config'
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
  BasicDataSnapshot, DictionarySnapshot, FieldColumnSnapshot, FileTypeTreeSnapshot, FlowDataSnapshot, ListColumnSnapshot, MailTypeSnapshot, PickerSnapshot, ReviewerSnapshot
} from './types'
import { buildPickerCatalog } from './picker-catalog'
import { readReviewers } from './reviewers'

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

  loadMailTypes(userKey: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<MailTypeSnapshot>> {
    return this.cache.load(this.cache.mailTypeKey(userKey), force, async () => {
      const response = await this.transport.post('mailType', params({ Call: 'LoadMailType', log_pagename: 'FileSearchMail.aspx' }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      const raw = body.data.MailType
      if (raw !== null && raw !== undefined && !Array.isArray(raw)) return apiError('INVALID_RESPONSE', '发文类型响应不是数组。')
      const nodes: MailTypeSnapshot['nodes'] = []
      const diagnostics: string[] = []
      for (const row of Array.isArray(raw) ? raw : []) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          diagnostics.push('忽略了无法识别的发文类型。')
          continue
        }
        const record = row as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const name = typeof record.name === 'string' ? record.name.trim() : ''
        const parentId = typeof record.pid === 'string' ? record.pid.trim() : ''
        const treeType = typeof record.TreeType === 'string' ? record.TreeType : ''
        if (!isQueryGuid(id) || !name) {
          diagnostics.push('忽略了缺少 ID 或名称的发文类型。')
          continue
        }
        if (nodes.some(node => node.id === id)) {
          diagnostics.push('忽略了重复的发文类型。')
          continue
        }
        nodes.push({ id, name, parentId, treeType })
      }
      return { ok: true, data: { kind: 'mailType', nodes, diagnostics } }
    })
  }

  loadReviewers(userKey: string, force: boolean, signal?: AbortSignal): Promise<ApiResult<ReviewerSnapshot>> {
    return this.cache.load(this.cache.reviewerKey(userKey), force, async () => {
      const response = await this.transport.post('treeUser', params({ Call: 'GetTreeUser', log_pagename: PAGE }), signal)
      if (!response.ok) return response
      const body = readDictionaryBody(response.data)
      if (!body.ok) return body
      const raw = body.data.TreeUser
      if (raw !== null && raw !== undefined && !Array.isArray(raw)) return apiError('INVALID_RESPONSE', '审核人响应不是数组。')
      return { ok: true, data: { kind: 'reviewer', reviewers: readReviewers(body.data) } }
    })
  }

  loadPicker(
    userKey: string,
    force: boolean,
    caseTypeId = '',
    signal?: AbortSignal,
    filter: { country?: string; procType?: string } = {}
  ): Promise<ApiResult<PickerSnapshot>> {
    const country = typeof filter.country === 'string' && /^[A-Za-z0-9_,-]{0,400}$/.test(filter.country) ? filter.country : ''
    const procType = isQueryGuid(filter.procType ?? '') ? filter.procType ?? '' : ''
    const caseType = isQueryGuid(caseTypeId) ? caseTypeId : CURRENT_ENVIRONMENT.caseTypeId
    return this.cache.load(this.cache.pickerKey(userKey, `${caseType}|${country}|${procType}`), force, async () => {
      const jobs = [
        ['dept', 'deptTree', { Call: 'LoadDeptTree', log_pagename: 'FileSearch.aspx' }],
        ['user', 'treeUser', { Call: 'GetTreeUser', log_pagename: 'FileSearch.aspx' }],
        ['agent', 'treeAgent', { Call: 'GetTreeAgent', log_pagename: 'FileSearch.aspx' }],
        ['fileTemp', 'fileTempList', { Call: 'GetFileTempNameList', log_pagename: 'FileSearch.aspx' }],
        ['branch', 'deptBranch', { Call: 'GetDeptBranch', log_pagename: 'LimitMonitor.aspx' }],
        ['applyTags', 'applyTags', { Call: 'GetApplyTags', log_pagename: 'LimitMonitor.aspx' }],
        ['limitInit', 'limitInit', { Call: 'LimitMonitorInit', log_pagename: 'LimitMonitor.aspx' }],
        ['limitCtrl', 'limitCtrlProc', {
          Call: 'LimitMonitorGetCtrlproc', case_type: caseType, country, proc_type: procType, log_pagename: 'LimitMonitor.aspx'
        }]
      ] as const
      const settled = await Promise.all(jobs.map(async ([name, operation, fields]) => {
        const response = await this.transport.post(operation, params(fields), signal)
        if (!response.ok) return [name, response] as const
        return [name, readDictionaryBody(response.data)] as const
      }))
      if (settled.every(([, result]) => !result.ok && result.error.code === 'SESSION_EXPIRED')) {
        const failed = settled[0][1]
        if (!failed.ok) return failed
      }
      const sources: Record<string, unknown> = {}
      const warnings: string[] = []
      for (const [name, result] of settled) {
        if (!result.ok) {
          warnings.push(`${name} 没有读到：${result.error.message}`)
          sources[name] = null
          continue
        }
        sources[name] = result.data
      }
      const built = buildPickerCatalog(sources)
      return { ok: true, data: { kind: 'picker', dictionaries: built.dictionaries, warnings: [...warnings, ...built.warnings] } }
    })
  }

  load(
    kind: DictionarySnapshot['kind'],
    userKey: string,
    force: boolean,
    caseTypeId = '',
    signal?: AbortSignal,
    picker: { country?: string; procType?: string } = {}
  ): Promise<ApiResult<DictionarySnapshot>> {
    if (kind === 'basic') return this.loadBasic(userKey, force, signal)
    if (kind === 'flow') return this.loadFlow(userKey, force, signal)
    if (kind === 'fileType') return this.loadFileTypes(userKey, caseTypeId, force, signal)
    if (kind === 'fieldColumn') return this.loadFieldColumns(userKey, force, signal)
    if (kind === 'mailType') return this.loadMailTypes(userKey, force, signal)
    if (kind === 'reviewer') return this.loadReviewers(userKey, force, signal)
    if (kind === 'picker') return this.loadPicker(userKey, force, caseTypeId, signal, picker)
    return this.loadListColumns(userKey, force, signal)
  }
}
