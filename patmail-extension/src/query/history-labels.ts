/** 同名模板各有自己的 query_id。重复标题后面带上编号前缀，列表里才能分开点。 */
export function historyLabels(options: Array<{ id: string; name: string }>): Map<string, string> {
  const totals = new Map<string, number>()
  for (const item of options) totals.set(item.name, (totals.get(item.name) ?? 0) + 1)
  const labels = new Map<string, string>()
  for (const item of options) {
    const repeated = (totals.get(item.name) ?? 0) > 1
    const mark = item.id.split('-')[0] || item.id.slice(0, 8)
    labels.set(item.id, repeated && mark ? `${item.name} · ${mark}` : item.name)
  }
  return labels
}
