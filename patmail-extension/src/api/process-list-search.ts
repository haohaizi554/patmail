import type { ProcessKind, ProcessListRow } from './mail-process'

/** 和发文记录三个页签的搜索提示一致。 */
export const PROCESS_SEARCH_FIELDS: Record<ProcessKind, readonly string[]> = {
  AP: ['apply_name', 'customer_name', 'tcase_volume'],
  EF: ['case_volume', 'customer_name', 'case_name'],
  CO: ['mail_subject', 'customer_name', 'mailtoname']
}

export function filterProcessRows(rows: ProcessListRow[], kind: ProcessKind, searchKey: string): ProcessListRow[] {
  const needle = searchKey.trim().toLocaleLowerCase()
  if (!needle) return rows
  const fields = PROCESS_SEARCH_FIELDS[kind]
  return rows.filter(row => fields.some(field => (row.cells[field] ?? '').toLocaleLowerCase().includes(needle)))
}
