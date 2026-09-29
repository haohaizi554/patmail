import type { LimitMailStyle, PctTaskRow } from './types'

function groupsBy(rows: PctTaskRow[], keyOf: (row: PctTaskRow) => string): PctTaskRow[][] {
  const groups = new Map<string, PctTaskRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return [...groups.values()]
}

function customerKey(row: PctTaskRow): string {
  return row.customerName.trim() || row.ourVolume
}

/** 期限监控里客户已经选好的合成方式。没选时按一件一封。同客户合并按行上的客户名称拆开。 */
export function groupWorkflowRows(style: LimitMailStyle | undefined, rows: PctTaskRow[]): PctTaskRow[][] {
  if (!rows.length) return []
  if (style === '1') return groupsBy(rows, customerKey)
  if (style === '3') {
    return groupsBy(rows, row => `${customerKey(row)}\n${row.contactName.trim() || row.ourVolume}`)
  }
  return rows.map(row => [row])
}
