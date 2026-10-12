/** 同名模板按列表顺序区分。先出现的保留原名，后加的才在后面带上编号，才能看出哪个是原来的。 */
export function historyLabels(options: Array<{ id: string; name: string }>): Map<string, string> {
  const seen = new Set<string>()
  const labels = new Map<string, string>()
  for (const item of options) {
    if (!seen.has(item.name)) {
      seen.add(item.name)
      labels.set(item.id, item.name)
      continue
    }
    const mark = item.id.split('-')[0] || item.id.slice(0, 8)
    labels.set(item.id, mark ? `${item.name} · ${mark}` : item.name)
  }
  return labels
}
