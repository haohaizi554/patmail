import {
  adaptBussType, adaptDictionaryValue, adaptNodeTree
} from './adapters'
import type { DictionaryOption, NormalizedDictionary } from './types'

export interface TreeOptionChoice {
  value: string
  label: string
  parent?: string
}

/** 文件查询里仍要向原网站现拉的下拉，对应 picker 字典名。 */
export const FILE_PICKER_FIELDS: Record<string, string> = {
  dept_id: 'dept',
  sale_dept_id: 'dept',
  pic_dept_id: 'dept',
  sales: 'user',
  sales_help: 'user',
  upuser: 'user',
  pic_user: 'user',
  foreign_pic: 'user',
  agency_user_id: 'user',
  user_assistant: 'user',
  revise_user_id: 'user',
  case_flow_user: 'user',
  customer_flow_user: 'user',
  payment_review_user_id: 'user',
  pat_production_user_id: 'user',
  pat_patauditor_user_id: 'user',
  pat_allocator_user_id: 'user',
  agency_id: 'agent',
  other_agency_id: 'agent',
  filetemp: 'fileTemp',
  apply_tags_id: 'applyTags'
}

/** 期限监控下拉。国家、类型、事项都来自期限页自己的初始化接口。 */
export const LIMIT_PICKER_FIELDS: Record<string, string> = {
  country: 'limitCountry',
  customer_country: 'limitCountry',
  case_type: 'limitCaseType',
  business_type_other: 'limitBussType',
  apply_subject: 'limitApplyType',
  case_status_id: 'limitCaseStatus',
  customer_status_id: 'limitCustomerStatus',
  proc_status: 'limitProcStatus',
  flow_direction: 'limitDirection',
  proc_type: 'limitProcType',
  dept_id: 'dept',
  pic_dept_id: 'dept',
  branch_dept: 'branch',
  ctrl_proc: 'limitCtrlProc',
  proc_pic_user: 'user',
  case_pic_user: 'user',
  revise_user_id: 'user',
  sales: 'user',
  sales_help: 'user',
  flow_user_id: 'user',
  user_assistant: 'user',
  other_agency_id: 'agent',
  apply_tags_id: 'applyTags'
}

function arrayOf(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>)[key]
  return value === undefined ? null : value
}

function withCaseType(dictionary: NormalizedDictionary, raw: unknown): NormalizedDictionary {
  if (!Array.isArray(raw)) return dictionary
  const types = new Map<string, string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    const id = typeof record.value === 'string' ? record.value : ''
    const caseTypeId = typeof record.case_type_id === 'string' ? record.case_type_id : ''
    const countryId = typeof record.country_id === 'string' ? record.country_id : ''
    if (id && (caseTypeId || countryId)) types.set(id, `${caseTypeId}\n${countryId}`)
  }
  if (types.size === 0) return dictionary
  return {
    ...dictionary,
    options: dictionary.options.map(option => {
      const extra = types.get(option.value)
      if (!extra) return option
      const [caseTypeId, countryId] = extra.split('\n')
      return {
        ...option,
        metadata: {
          ...option.metadata,
          ...(caseTypeId ? { caseTypeId } : {}),
          ...(countryId ? { countryId } : {})
        }
      }
    })
  }
}

/** 期限页只把案件状态（ALL / CASE）放进案件状态下拉。 */
function caseStatusRows(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.filter(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false
    const statusClass = (row as Record<string, unknown>).status_class
    const value = typeof statusClass === 'string' ? statusClass : ''
    return value === '' || value === 'ALL' || value === 'CASE'
  })
}

/** 事项类型的提交值是 dictionary_id，不是 OM / IM。 */
function procTypeRows(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const record = row as Record<string, unknown>
    const value = typeof record.dictionary_id === 'string' && record.dictionary_id
      ? record.dictionary_id
      : record.value
    const label = record.text_zh_cn ?? record.text
    return { value, text_zh_cn: label }
  })
}

/** 把各只读接口的响应收成下拉字典。某个接口失败时由调用方传入 null。 */
export function buildPickerCatalog(sources: Record<string, unknown>): { dictionaries: Record<string, NormalizedDictionary>; warnings: string[] } {
  const warnings: string[] = []
  const dictionaries: Record<string, NormalizedDictionary> = {
    dept: adaptNodeTree('dept', arrayOf(sources.dept, 'DeptTree')),
    user: adaptNodeTree('user', arrayOf(sources.user, 'TreeUser')),
    agent: adaptNodeTree('agent', arrayOf(sources.agent, 'TreeUser')),
    fileTemp: adaptNodeTree('fileTemp', arrayOf(sources.fileTemp, 'TempNameList')),
    branch: adaptNodeTree('branch', arrayOf(sources.branch, 'BranchList')),
    applyTags: adaptNodeTree('applyTags', arrayOf(sources.applyTags, 'ApplyTags')),
    limitCountry: adaptDictionaryValue('limitCountry', arrayOf(sources.limitInit, 'CountryInfo')),
    limitCaseType: adaptDictionaryValue('limitCaseType', arrayOf(sources.limitInit, 'CaseType')),
    limitProcStatus: adaptDictionaryValue('limitProcStatus', arrayOf(sources.limitInit, 'ProcStatus')),
    limitCustomerStatus: adaptDictionaryValue('limitCustomerStatus', arrayOf(sources.limitInit, 'CustomerStatus')),
    limitApplyType: withCaseType(adaptDictionaryValue('limitApplyType', arrayOf(sources.limitInit, 'apply_type')), arrayOf(sources.limitInit, 'apply_type')),
    limitCaseStatus: withCaseType(adaptDictionaryValue('limitCaseStatus', caseStatusRows(arrayOf(sources.limitInit, 'case_status'))), caseStatusRows(arrayOf(sources.limitInit, 'case_status'))),
    limitDirection: adaptDictionaryValue('limitDirection', arrayOf(sources.limitInit, 'Case_direction')),
    limitBussType: adaptBussType(arrayOf(sources.limitInit, 'BussType')),
    limitProcType: adaptDictionaryValue('limitProcType', procTypeRows(arrayOf(sources.limitInit, 'procType'))),
    limitCtrlProc: adaptNodeTree('limitCtrlProc', arrayOf(sources.limitCtrl, 'CtrlProc'))
  }
  for (const [name, dictionary] of Object.entries(dictionaries)) {
    if (dictionary.status === 'invalid') warnings.push(`${name} 的选项没有读全。`)
  }
  return { dictionaries, warnings }
}

const PICKER_RECEIPT: Record<string, string> = {
  dept: '部门',
  user: '人员',
  agent: '代理机构',
  fileTemp: '下载名称',
  branch: '分部',
  limitCountry: '国家',
  limitCaseType: '案件类型',
  limitBussType: '业务类型',
  limitApplyType: '申请类型',
  limitCtrlProc: '处理事项',
  limitProcType: '事项类型'
}

/** 给页面一行回执，确认哪些下拉已经换成原网站返回的数量。 */
export function describePickerReceipt(dictionaries: Record<string, NormalizedDictionary>, warnings: string[] = []): string {
  const got = Object.entries(PICKER_RECEIPT).flatMap(([key, label]) => {
    const count = dictionaries[key]?.options.length ?? 0
    return count > 0 ? [`${label} ${count}`] : []
  })
  const head = got.length ? `已用原网站下拉：${got.join('、')}` : '原网站下拉没有读到选项，这些格子仍显示上次扫描的结果'
  return warnings.length ? `${head}。${warnings[0]}` : head
}

export function choicesFromDictionary(dictionary: NormalizedDictionary | undefined, caseTypeId = '', countryIds = ''): TreeOptionChoice[] {
  if (!dictionary) return []
  let options: DictionaryOption[] = dictionary.options.filter(item => !item.disabled)
  if (caseTypeId && options.some(item => item.metadata?.caseTypeId)) {
    const matched = options.filter(item => item.metadata?.caseTypeId === caseTypeId)
    if (matched.length) options = matched
  }
  if (options.some(item => item.metadata?.countryId)) {
    const selected = new Set(countryIds.split(',').map(item => item.trim()).filter(Boolean))
    options = options.filter(item => {
      const country = item.metadata?.countryId ?? ''
      return !country || country === 'ALL' || selected.has(country)
    })
  }
  return options.map(item => ({
    value: item.value,
    label: item.label,
    ...(item.parentValue ? { parent: item.parentValue } : {})
  }))
}
