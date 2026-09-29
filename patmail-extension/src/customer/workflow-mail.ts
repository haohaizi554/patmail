import type { LimitMailStyle, PctTaskRow } from './types'

/** 期限监控里客户已经选好的合成方式。没选时按一件一封。 */
export function groupWorkflowRows(style: LimitMailStyle | undefined, rows: PctTaskRow[]): PctTaskRow[][] {
  if (!rows.length) return []
  if (style === '1') return [rows]
  if (style === '3') {
    const groups = new Map<string, PctTaskRow[]>()
    for (const row of rows) {
      const key = row.contactName.trim() || row.ourVolume
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }
    return [...groups.values()]
  }
  return rows.map(row => [row])
}
