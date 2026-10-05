/** 仓库 API/ 下的接口记录。构建时打进后台，助手按关键词取片段，不整库塞进每一轮。 */

export interface ApiDocSection {
  file: string
  heading: string
  body: string
}

const rawFiles = import.meta.glob('../../../API/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

function fileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/** 按二级标题切开。一级标题当作这篇文档的名字。 */
export function sectionsFromMarkdown(file: string, markdown: string): ApiDocSection[] {
  const lines = markdown.split(/\r?\n/)
  let title = file.replace(/\.md$/i, '')
  let heading = ''
  let buf: string[] = []
  const sections: ApiDocSection[] = []
  const push = (): void => {
    const body = buf.join('\n').trim()
    buf = []
    if (!body) return
    sections.push({ file, heading: heading ? `${title} / ${heading}` : title, body })
  }
  for (const line of lines) {
    if (line.startsWith('# ')) {
      title = line.slice(2).trim() || title
      continue
    }
    if (line.startsWith('## ')) {
      push()
      heading = line.slice(3).trim()
      continue
    }
    buf.push(line)
  }
  push()
  return sections
}

let cached: ApiDocSection[] | null = null

export function apiDocSections(): ApiDocSection[] {
  if (cached) return cached
  cached = Object.entries(rawFiles).flatMap(([path, text]) => sectionsFromMarkdown(fileName(path), text))
  return cached
}

export function apiDocFiles(): string[] {
  return [...new Set(apiDocSections().map(section => section.file))].sort()
}

function readmeText(): string {
  const hit = Object.entries(rawFiles).find(([path]) => fileName(path) === 'README.md')
  return hit?.[1] ?? ''
}

function entryCounts(text: string): Array<{ name: string; count: number }> {
  const start = text.indexOf('## 入口一览')
  if (start < 0) return []
  const end = text.indexOf('## 全部接口', start)
  const block = text.slice(start, end > start ? end : undefined)
  const rows: Array<{ name: string; count: number }> = []
  for (const line of block.split(/\r?\n/)) {
    const matched = /^\|\s*(?:\[([^\]]+)\]\([^)]+\)|([^|]+?))\s*\|\s*(\d+)\s*\|/.exec(line)
    if (!matched) continue
    const name = (matched[1] || matched[2] || '').trim()
    if (!name || name === '入口') continue
    rows.push({ name, count: Number(matched[3]) })
  }
  return rows
}

function callRowCount(text: string): number {
  const start = text.indexOf('## 全部接口')
  if (start < 0) return 0
  return text.slice(start).split(/\r?\n/).filter(line => /^\|\s*`[^`]+`\s*\|/.test(line)).length
}

/** 问「一共有多少接口」时用。个数来自索引表，不把文档篇数当成接口数。 */
export function apiCatalogBrief(): string {
  const text = readmeText()
  const entries = entryCounts(text)
  const listed = entries.filter(item => item.name !== '合计')
  const declared = entries.find(item => item.name === '合计')?.count ?? 0
  const summed = listed.reduce((total, item) => total + item.count, 0)
  const calls = callRowCount(text)
  if (listed.length === 0 || calls === 0) return '索引里没有数出接口个数。不要凭文档篇数估计。'
  const lines = listed.map(item => `${item.name} ${item.count}`)
  const agree = declared === summed && summed === calls
  return [
    `按入口和 Call 去重，一共 ${calls} 个接口。`,
    agree ? '入口表的合计、各入口相加、索引里的 Call 行，三个数一致。' : `入口表合计 ${declared}，各入口相加 ${summed}，Call 行 ${calls}。这三个数不一致，回答时要把三个数都说出来，不要另编一个。`,
    '这是接口个数，不是文档篇数。',
    ...lines,
    '回答只报这个数，可以带上入口分布。不要把 md 文件篇数说成接口数，也不要再写一段接口涵盖哪些方面。'
  ].join('\n')
}

function asksForCatalog(query: string): boolean {
  const text = query.trim()
  return /多少|几个|一共|总数|数量|清单|有哪些入口|入口一览/.test(text) && /接口|Call|入口/.test(text)
}

function tokensOf(query: string): string[] {
  const whole = query.trim().toLowerCase()
  const parts = whole.split(/[\s,，。；;、/]+/).map(item => item.trim()).filter(item => item.length >= 2)
  return [...new Set(whole.length >= 2 ? [whole, ...parts] : parts)]
}

function excerpt(body: string, token: string, max = 1_200): string {
  const at = token ? body.toLowerCase().indexOf(token) : 0
  const start = at > 180 ? at - 180 : 0
  const slice = body.slice(start, start + max).trim()
  return start > 0 ? `…${slice}` : slice
}

/** 用 Call 名、ashx 入口或中文主题找最相关的几段。 */
export function searchApiSections(sections: ApiDocSection[], query: string, limit = 4): string {
  const tokens = tokensOf(query)
  if (tokens.length === 0) return '请给出 Call 名、ashx 入口或中文主题。'
  const ranked = sections.map(section => {
    const file = section.file.toLowerCase()
    const heading = section.heading.toLowerCase()
    const body = section.body.toLowerCase()
    let score = 0
    let focus = tokens[0] ?? ''
    let focusAt = Number.POSITIVE_INFINITY
    for (const token of tokens) {
      const inFile = file.includes(token)
      const inHeading = heading.includes(token)
      const at = body.indexOf(token)
      if (inFile) score += 8
      if (inHeading) score += 6
      if (at >= 0) {
        const times = body.split(token).length - 1
        score += Math.min(times, 4) * 3
        if (/^[a-z][a-z0-9_]{2,}$/.test(token)) score += 8
        if (at < focusAt) {
          focusAt = at
          focus = token
        }
      }
    }
    return { section, score, focus }
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
  if (ranked.length === 0) {
    const names = [...new Set(sections.map(section => section.file))].sort().join('、')
    return `文档里没有对上「${query.trim().slice(0, 80)}」。现有文档：${names}`
  }
  const body = ranked.map(item => `【${item.section.file}】${item.section.heading}\n${excerpt(item.section.body, item.focus)}`).join('\n\n')
  return `以下是接口文档片段，只用于对照字段和调用方式，不是这次已经发出的请求。\n\n${body}`
}

export function searchApiDocs(query: string): string {
  if (asksForCatalog(query)) return apiCatalogBrief()
  return searchApiSections(apiDocSections(), query)
}
