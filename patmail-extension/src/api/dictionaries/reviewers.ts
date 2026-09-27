import { isQueryGuid } from '../../query/query-validator'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 人员树里的人。部门节点不进入审核人列表。 */
export function readReviewers(data: unknown): Array<{ id: string; name: string }> {
  const source = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { TreeUser?: unknown }).TreeUser
    : data
  if (!Array.isArray(source)) return []
  const rows = source.filter(row => row && typeof row === 'object' && !Array.isArray(row)) as Array<Record<string, unknown>>
  const people = rows.filter(row => /^user$/i.test(text(row.TreeType)))
  const chosen = people.length > 0 ? people : leafPeople(rows)
  const reviewers: Array<{ id: string; name: string }> = []
  for (const row of chosen) {
    const id = text(row.id)
    const name = text(row.name)
    if (!isQueryGuid(id) || !name || reviewers.some(item => item.id.toLowerCase() === id.toLowerCase())) continue
    reviewers.push({ id, name })
  }
  return reviewers
}

function leafPeople(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const parents = new Set(rows.map(row => text(row.pid).toLowerCase()).filter(Boolean))
  return rows.filter(row => {
    const id = text(row.id)
    return isQueryGuid(id) && !parents.has(id.toLowerCase())
  })
}
