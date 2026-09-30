import { sheetRecipientNames, type PctRecipientMode } from './pct-recipients'
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

/** 同客户合并时，收件人或抄送不同的行再拆成另一封。specials 是用户在工作流里写下的客户。 */
export function groupWorkflowRows(
  style: LimitMailStyle | undefined,
  rows: PctTaskRow[],
  specials: ReadonlySet<string> = new Set(),
  mode: PctRecipientMode = 'ipr'
): PctTaskRow[][] {
  if (!rows.length) return []
  if (style === '1') {
    return groupsBy(rows, row => {
      const names = sheetRecipientNames(row, specials, mode)
      const to = (row.mailTo || names.to).replace(/\s/g, '')
      const cc = (row.mailCc || names.cc).replace(/\s/g, '')
      return `${customerKey(row)}\n${to}\n${cc}`
    })
  }
  if (style === '3') {
    return groupsBy(rows, row => `${customerKey(row)}\n${row.contactName.trim() || row.ourVolume}`)
  }
  return rows.map(row => [row])
}
