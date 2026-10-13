/** 同名模板按列表顺序区分。原站的列表新保存在前，靠后的才是原来那份：原来的保留原名，后建的带编号。 */
export function historyLabels(options: Array<{ id: string; name: string }>): Map<string, string> {
  const lastAt = new Map<string, number>()
  options.forEach((item, index) => {
    if (item.name) lastAt.set(item.name, index)
  })
  const labels = new Map<string, string>()
  options.forEach((item, index) => {
    if (!item.name || lastAt.get(item.name) === index) {
      labels.set(item.id, item.name)
      return
    }
    const mark = item.id.split('-')[0] || item.id.slice(0, 8)
    labels.set(item.id, mark ? `${item.name} · ${mark}` : item.name)
  })
  return labels
}