/** 仓库 API/ 下的接口记录。构建时打进后台，问句按词检索相关片段，不整库塞进每一轮。 */

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

const WEAK_CHAR = new Set('的了吗呢啊吧呀方面些么怎这那个和与或及为在是有不要会能把被对从到也就都很还又而但过着'.split(''))

function foldTerms(text: string): string {
  return text.toLowerCase().replace(/登陆/g, '登录').replace(/登入/g, '登录')
}

/** 英文 Call、ashx 名，以及中文二字词。虚词不进检索。 */
function termsOf(text: string): string[] {
  const norm = foldTerms(text)
  const terms: string[] = []
  for (const match of norm.matchAll(/[a-z][a-z0-9_]{2,}/g)) terms.push(match[0])
  for (const match of norm.matchAll(/[a-z0-9]+(?:\.[a-z0-9]+)+/g)) {
    for (const part of match[0].split('.')) if (part.length >= 2) terms.push(part)
  }
  for (const run of norm.matchAll(/[\u4e00-\u9fff]+/g)) {
    const chars = [...run[0]].filter(char => !WEAK_CHAR.has(char))
    for (let index = 0; index < chars.length - 1; index += 1) terms.push(chars[index] + chars[index + 1])
    if (chars.length >= 2 && chars.length <= 8) terms.push(chars.join(''))
  }
  return [...new Set(terms)]
}

function passagesOf(section: ApiDocSection): ApiDocSection[] {
  const body = section.body.trim()
  if (body.length <= 720) return [section]
  const chunks: ApiDocSection[] = []
  let start = 0
  while (start < body.length) {
    let end = Math.min(body.length, start + 720)
    if (end < body.length) {
      const breakAt = body.lastIndexOf('\n', end)
      if (breakAt > start + 400) end = breakAt
    }
    const slice = body.slice(start, end).trim()
    if (slice) chunks.push({ file: section.file, heading: section.heading, body: slice })
    if (end >= body.length) break
    start = Math.max(end - 80, start + 1)
  }
  return chunks
}

interface IndexedPassage {
  section: ApiDocSection
  tf: Map<string, number>
  length: number
  heading: Set<string>
  file: Set<string>
}

interface DocIndex {
  passages: IndexedPassage[]
  df: Map<string, number>
  avg: number
}

const indexes = new WeakMap<ApiDocSection[], DocIndex>()

function indexOf(sections: ApiDocSection[]): DocIndex {
  const cached = indexes.get(sections)
  if (cached) return cached
  const df = new Map<string, number>()
  const passages = sections.flatMap(passagesOf).map(section => {
    const counts = new Map<string, number>()
    for (const term of termsOf(section.body)) counts.set(term, (counts.get(term) ?? 0) + 1)
    for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1)
    const length = [...counts.values()].reduce((sum, count) => sum + count, 0)
    return { section, tf: counts, length, heading: new Set(termsOf(section.heading)), file: new Set(termsOf(section.file)) }
  })
  for (const passage of passages) {
    for (const term of new Set([...passage.heading, ...passage.file])) {
      if (!passage.tf.has(term)) df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const avg = passages.reduce((sum, passage) => sum + passage.length, 0) / Math.max(passages.length, 1)
  const built = { passages, df, avg }
  indexes.set(sections, built)
  return built
}

function termScore(tf: number, df: number, docs: number, length: number, avg: number): number {
  const idf = Math.log(1 + (docs - df + 0.5) / (df + 0.5))
  const k1 = 1.2
  const b = 0.55
  return idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * length / Math.max(avg, 1)))
}

/** 用 Call 名、ashx 入口或中文主题找最相关的几段。问句不必和原文一致。 */
export function searchApiSections(sections: ApiDocSection[], query: string, limit = 4): string {
  const tokens = termsOf(query)
  if (tokens.length === 0) return '请给出 Call 名、ashx 入口或中文主题。'
  const index = indexOf(sections)
  const docs = index.passages.length
  const best = new Map<string, { section: ApiDocSection; score: number }>()
  for (const passage of index.passages) {
    let score = 0
    for (const token of tokens) {
      const df = index.df.get(token) ?? 0
      if (df === 0) continue
      const tf = passage.tf.get(token) ?? 0
      if (tf > 0) score += termScore(tf, df, docs, passage.length, index.avg)
      if (passage.heading.has(token)) score += termScore(1, df, docs, 1, 1) * 2.4
      if (passage.file.has(token)) score += termScore(1, df, docs, 1, 1) * 1.6
    }
    if (score <= 0) continue
    const key = `${passage.section.file}\n${passage.section.heading}`
    const previous = best.get(key)
    if (!previous || score > previous.score) best.set(key, { section: passage.section, score })
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  if (ranked.length === 0) {
    const names = [...new Set(sections.map(section => section.file))].sort().join('、')
    return `文档里没有对上「${query.trim().slice(0, 80)}」。现有文档：${names}`
  }
  const body = ranked.map(item => `【${item.section.file}】${item.section.heading}\n${item.section.body.slice(0, 700).trim()}`).join('\n\n')
  return `以下是接口文档片段，只用于对照字段和调用方式，不是这次已经发出的请求。\n\n${body}`
}

export function searchApiDocs(query: string): string {
  if (asksForCatalog(query)) return apiCatalogBrief()
  return searchApiSections(apiDocSections(), query)
}
