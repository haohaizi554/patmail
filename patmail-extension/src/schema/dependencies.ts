import type { DictionaryOption } from '../api/dictionaries/types'

const CASE_SCOPED = new Set(['applyType', 'bussType', 'caseStatus', 'customerStatus', 'ctrlProc'])

/** 案件状态、申请类型和业务类型只保留当前案件类型，不把全部类型混在一个列表里。 */
export function optionsForCaseType(dictionaryKey: string, options: DictionaryOption[], caseTypeId: string): DictionaryOption[] {
  if (!CASE_SCOPED.has(dictionaryKey)) return options.filter(item => !item.disabled)
  if (!caseTypeId) return []
  return options.filter(item => {
    if (item.disabled) return false
    if (item.metadata?.caseTypeId !== caseTypeId) return false
    if (dictionaryKey === 'caseStatus') {
      const statusClass = item.metadata?.statusClass
      return statusClass === 'ALL' || statusClass === 'CASE'
    }
    return true
  })
}
