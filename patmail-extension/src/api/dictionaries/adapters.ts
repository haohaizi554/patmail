import { xmlNodeToApiField } from '../../query/field-registry'
import { isQueryGuid } from '../../query/query-validator'
import type { CustomFieldColumn, DictionaryOption, NormalizedDictionary } from './types'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function meta(source: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(source).filter(([, value]) => value !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function option(value: string, label: string, extra?: { disabled?: boolean; parentValue?: string; order?: number; metadata?: Record<string, string> }): DictionaryOption {
  return {
    value,
    label,
    ...(extra?.disabled ? { disabled: true } : {}),
    ...(extra?.parentValue ? { parentValue: extra.parentValue } : {}),
    ...(extra?.order !== undefined ? { order: extra.order } : {}),
    ...(extra?.metadata ? { metadata: extra.metadata } : {})
  }
}

export function adaptRows(
  key: string,
  raw: unknown,
  mapRow: (row: Record<string, unknown>) => DictionaryOption | null
): NormalizedDictionary {
  if (raw === null || raw === undefined) {
    return { key, options: [], status: 'empty', warnings: raw === undefined ? [`字典 ${key} 缺失。`] : [] }
  }
  if (!Array.isArray(raw)) {
    return { key, options: [], status: 'invalid', warnings: [`字典 ${key} 不是数组。`] }
  }
  const options: DictionaryOption[] = []
  let skipped = 0
  for (const row of raw) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      skipped += 1
      continue
    }
    const mapped = mapRow(row as Record<string, unknown>)
    if (!mapped || !mapped.value || !mapped.label) skipped += 1
    else options.push(mapped)
  }
  if (options.length === 0 && raw.length === 0) return { key, options, status: 'empty', warnings: [] }
  if (skipped > 0) {
    return { key, options, status: options.length > 0 ? 'partial' : 'invalid', warnings: [`字典 ${key} 有 ${skipped} 项无法识别。`] }
  }
  return { key, options, status: 'ready', warnings: [] }
}

export function adaptCaseType(raw: unknown): NormalizedDictionary {
  return adaptRows('caseType', raw, row => {
    const value = text(row.case_type_id)
    const label = text(row.case_type)
    if (!isQueryGuid(value) || !label) return null
    return option(value, label, { metadata: meta({ code: text(row.case_type_code) }) })
  })
}

export function adaptCountry(raw: unknown): NormalizedDictionary {
  return adaptRows('country', raw, row => {
    const value = text(row.value)
    const label = text(row.text_zh_cn)
    if (!value || !label || value.length > 64) return null
    return option(value, label, { metadata: meta({ countryCode: text(row.country_code) }) })
  })
}

export function adaptCaseStatus(raw: unknown): NormalizedDictionary {
  return adaptRows('caseStatus', raw, row => {
    const value = text(row.case_status_id)
    const label = text(row.case_status)
    if (!isQueryGuid(value) || !label) return null
    return option(value, label, { metadata: meta({ caseTypeId: text(row.case_type_id), statusClass: text(row.status_class) }) })
  })
}

export function adaptApplyType(raw: unknown): NormalizedDictionary {
  return adaptRows('applyType', raw, row => {
    const value = text(row.apply_type_id)
    const label = text(row.apply_type)
    if (!isQueryGuid(value) || !label) return null
    return option(value, label, { metadata: meta({ caseTypeId: text(row.case_type_id), countryId: text(row.country_id) }) })
  })
}

export function adaptBussType(raw: unknown): NormalizedDictionary {
  return adaptRows('bussType', raw, row => {
    const value = text(row.business_type_id)
    const label = text(row.bussType)
    if (!isQueryGuid(value) || !label) return null
    return option(value, label, { metadata: meta({ caseTypeId: text(row.case_type_id), code: text(row.business_type_code) }) })
  })
}

export function adaptCustomerStatus(raw: unknown): NormalizedDictionary {
  return adaptRows('customerStatus', raw, row => {
    const value = text(row.customer_status_id)
    const label = text(row.customer_status)
    if (!value || !label) return null
    return option(value, label, { metadata: meta({ caseTypeId: text(row.case_type_id) }) })
  })
}

export function adaptCtrlProc(raw: unknown): NormalizedDictionary {
  return adaptRows('ctrlProc', raw, row => {
    const value = text(row.ctrl_proc_id)
    const label = text(row.ctrl_proc)
    if (!isQueryGuid(value) || !label) return null
    return option(value, label, { metadata: meta({ caseTypeId: text(row.case_type_id) }) })
  })
}

export function adaptProcStatus(raw: unknown): NormalizedDictionary {
  return adaptRows('procStatus', raw, row => {
    const value = text(row.proc_status_id)
    const label = text(row.proc_status)
    if (!value || !label) return null
    return option(value, label, { metadata: meta({ code: text(row.status_code) }) })
  })
}

export function adaptDictionaryValue(key: string, raw: unknown): NormalizedDictionary {
  return adaptRows(key, raw, row => {
    const value = text(row.value)
    const label = text(row.text_zh_cn)
    if (!value || !label || value.length > 80) return null
    return option(value, label, { order: typeof row.seq === 'number' ? row.seq : undefined })
  })
}

/** 下载名称模板要留下 new_filename 和 file_name_type，发文时才能交给 GetFileName。 */
export function adaptFileTemp(raw: unknown): NormalizedDictionary {
  return adaptRows('fileTemp', raw, row => {
    const value = text(row.id)
    const label = text(row.temp_name)
    if (!value || !label || value.length > 80) return null
    const newFilename = text(row.new_filename)
    const fileNameType = text(row.file_name_type)
    const metadata = newFilename && fileNameType && newFilename.length <= 2000 && fileNameType.length <= 500
      ? { newFilename, fileNameType }
      : undefined
    return option(value, label, metadata ? { metadata } : undefined)
  })
}

/** 部门树、人员树、代理机构树都是 id/name，父级在 pid 或 parent_id。 */
export function adaptNodeTree(key: string, raw: unknown): NormalizedDictionary {
  return adaptRows(key, raw, row => {
    const value = text(row.id) || text(row.dept_id) || text(row.business_type_id) || text(row.value)
    const label = text(row.name) || text(row.temp_name) || text(row.dept_name) || text(row.bussType) || text(row.text_zh_cn)
    if (!value || !label || value.length > 80) return null
    const parent = text(row.pid) || text(row.pId) || text(row.parent_id)
    return option(value, label, {
      parentValue: parent && parent !== value ? parent : undefined,
      metadata: meta({ caseTypeId: text(row.case_type_id) })
    })
  })
}

export function adaptBranchDept(raw: unknown): NormalizedDictionary {
  return adaptRows('caseBranchDept', raw, row => {
    const value = text(row.dept_id)
    const label = text(row.dept_name) || text(row.dept_full_name)
    if (!value || !label) return null
    const enabled = row.is_enabled
    return option(value, label, {
      disabled: enabled === false || enabled === 0 || enabled === '0' || enabled === 'false',
      parentValue: text(row.parent_id) || undefined,
      metadata: meta({ code: text(row.dept_code) })
    })
  })
}

/** GetFlowdirection 的处理状态使用 value，而不是 proc_status_id。 */
export function adaptFlowProcStatus(raw: unknown): NormalizedDictionary {
  return adaptRows('procStatus', raw, row => {
    const value = text(row.value)
    const label = text(row.text_zh_cn)
    if (!value || !label) return null
    return option(value, label, { metadata: meta({ code: text(row.status_code) }) })
  })
}

export function adaptFieldColumns(raw: unknown): { columns: CustomFieldColumn[]; warnings: string[] } {
  if (raw === null) return { columns: [], warnings: [] }
  if (!Array.isArray(raw)) return { columns: [], warnings: ['fieldColumn 不是数组。'] }
  const columns: CustomFieldColumn[] = []
  const warnings: string[] = []
  for (const row of raw) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      warnings.push('忽略了一条无法识别的自定义栏位。')
      continue
    }
    const record = row as Record<string, unknown>
    const columnId = text(record.column_id)
    const field = xmlNodeToApiField(columnId)
    const label = text(record.column_name)
    if (!field || !/^column[1-5]$/.test(field) || !label) {
      warnings.push('忽略了一条缺少栏位标识的自定义栏位。')
      continue
    }
    const enabled = record.is_enabled
    const knownEnabled = enabled === true || enabled === false
    if (!knownEnabled) warnings.push(`自定义栏位 ${columnId} 没有明确的启用状态。`)
    columns.push({
      columnId,
      field,
      label,
      enabled: enabled === true,
      controlName: text(record.control_name),
      status: knownEnabled ? 'ready' : 'partial'
    })
  }
  return { columns, warnings }
}

const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function adaptListColumns(raw: unknown): { fields: string[]; colsel: string | null; status: 'ready' | 'empty' | 'partial'; warnings: string[] } {
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) {
    return { fields: [], colsel: null, status: 'empty', warnings: [] }
  }
  if (!Array.isArray(raw)) return { fields: [], colsel: null, status: 'partial', warnings: ['show_column 不是数组。'] }
  const fields: string[] = []
  let skipped = 0
  for (const row of raw) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      skipped += 1
      continue
    }
    const name = text((row as Record<string, unknown>).item_value)
    if (!COLUMN_NAME.test(name)) skipped += 1
    else fields.push(name)
  }
  if (fields.length === 0) return { fields, colsel: null, status: 'partial', warnings: ['列表列配置没有可用字段，继续使用当前环境列。'] }
  return {
    fields,
    colsel: `;${fields.join(';')};`,
    status: skipped > 0 ? 'partial' : 'ready',
    warnings: skipped > 0 ? [`列表列配置跳过了 ${skipped} 项。`] : []
  }
}
