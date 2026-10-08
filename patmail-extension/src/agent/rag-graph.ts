/** 混合检索图。analyze 之后词法和语义并行，两路都到齐才融合。 */

export interface RagSection {
  file: string
  heading: string
  body: string
}
export const HYBRID_RAG_GRAPH = {
  nodes: ['analyze', 'lexical', 'dense', 'fuse'] as const,
  edges: [
    ['analyze', 'lexical'],
    ['analyze', 'dense'],
    ['lexical', 'fuse'],
    ['dense', 'fuse']
  ] as const
}

const WEAK_CHAR = new Set('的了吗呢啊吧呀方面些么怎这那个和与或及为在是有不要会能把被对从到也就都很还又而但过着'.split(''))
const DIM = 384
const RRF_K = 60
/** 切片或向量算法变了就加一，本地库对不上时整库重算。 */
export const RAG_INDEX_VERSION = 1
const CHANNEL_KEEP = 16
const HEADING_WEIGHT = 3
const FILE_WEIGHT = 2

export interface RagHit {
  section: RagSection
  score: number
  lexicalRank: number
  denseRank: number
}

export interface RagState {
  query: string
  tokens: string[]
  lexical: number[]
  dense: number[]
  hits: RagHit[]
}

interface IndexedPassage {
  section: RagSection
  tf: Map<string, number>
  length: number
  heading: Set<string>
  file: Set<string>
  vector: Float32Array
}

interface DocIndex {
  passages: IndexedPassage[]
  df: Map<string, number>
  gramDf: Map<string, number>
  avg: number
}

const indexes = new WeakMap<RagSection[], DocIndex>()

function foldTerms(text: string): string {
  return text.toLowerCase().replace(/登陆/g, '登录').replace(/登入/g, '登录')
}

/** 英文 Call、ashx 名，以及中文二字词。虚词不进词法检索。 */
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

/** 语义路用字符三元组，接住 Call 名前缀和没对齐的中文片段。 */
function gramsOf(text: string): string[] {
  const norm = foldTerms(text)
  const grams = termsOf(norm)
  for (const run of norm.matchAll(/[a-z0-9_]{3,}/g)) {
    const token = run[0]
    for (let index = 0; index < token.length - 2; index += 1) grams.push(token.slice(index, index + 3))
  }
  for (const run of norm.matchAll(/[\u4e00-\u9fff]+/g)) {
    const chars = [...run[0]].filter(char => !WEAK_CHAR.has(char))
    const token = chars.join('')
    for (let index = 0; index < token.length - 2; index += 1) grams.push(token.slice(index, index + 3))
  }
  return grams
}

function passagesOf(section: RagSection): RagSection[] {
  const body = section.body.trim()
  if (body.length <= 720) return [section]
  const chunks: RagSection[] = []
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

function idf(df: number, docs: number): number {
  return Math.log(1 + (docs - df + 0.5) / (df + 0.5))
}

function mix(text: string): { bucket: number; sign: number } {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const mixed = hash >>> 0
  return { bucket: mixed % DIM, sign: mixed & 1 ? 1 : -1 }
}

function paint(vector: Float32Array, grams: string[], weight: number, gramDf: Map<string, number>, docs: number): void {
  const counts = new Map<string, number>()
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  for (const [gram, count] of counts) {
    const df = gramDf.get(gram) ?? 0
    if (df === 0) continue
    const { bucket, sign } = mix(gram)
    vector[bucket] += sign * weight * count * idf(df, docs)
  }
}

function normalize(vector: Float32Array): void {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  if (norm === 0) return
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
}

function dot(left: Float32Array, right: Float32Array): number {
  let sum = 0
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index]
  return sum
}

function indexOf(sections: RagSection[]): DocIndex {
  const cached = indexes.get(sections)
  if (cached) return cached
  const drafts = sections.flatMap(passagesOf).map(section => {
    const counts = new Map<string, number>()
    for (const term of termsOf(section.body)) counts.set(term, (counts.get(term) ?? 0) + 1)
    const heading = new Set(termsOf(section.heading))
    const file = new Set(termsOf(section.file))
    const grams = new Set([
      ...gramsOf(section.body),
      ...gramsOf(section.heading),
      ...gramsOf(section.file)
    ])
    return { section, tf: counts, heading, file, grams }
  })
  const df = new Map<string, number>()
  const gramDf = new Map<string, number>()
  for (const draft of drafts) {
    for (const term of draft.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1)
    for (const term of new Set([...draft.heading, ...draft.file])) {
      if (!draft.tf.has(term)) df.set(term, (df.get(term) ?? 0) + 1)
    }
    for (const gram of draft.grams) gramDf.set(gram, (gramDf.get(gram) ?? 0) + 1)
  }
  const docs = Math.max(drafts.length, 1)
  const passages = drafts.map(draft => {
    const vector = new Float32Array(DIM)
    paint(vector, gramsOf(draft.section.body), 1, gramDf, docs)
    paint(vector, gramsOf(draft.section.heading), HEADING_WEIGHT, gramDf, docs)
    paint(vector, gramsOf(draft.section.file), FILE_WEIGHT, gramDf, docs)
    normalize(vector)
    const length = [...draft.tf.values()].reduce((sum, count) => sum + count, 0)
    return { section: draft.section, tf: draft.tf, length, heading: draft.heading, file: draft.file, vector }
  })
  const avg = passages.reduce((sum, passage) => sum + passage.length, 0) / docs
  const built = { passages, df, gramDf, avg }
  indexes.set(sections, built)
  return built
}

function termScore(tf: number, df: number, docs: number, length: number, avg: number): number {
  const k1 = 1.2
  const b = 0.55
  return idf(df, docs) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * length / Math.max(avg, 1)))
}

function lexicalRanks(index: DocIndex, tokens: string[]): number[] {
  const docs = index.passages.length
  const scored: Array<{ index: number; score: number }> = []
  index.passages.forEach((passage, passageIndex) => {
    let score = 0
    for (const token of tokens) {
      const df = index.df.get(token) ?? 0
      if (df === 0) continue
      const tf = passage.tf.get(token) ?? 0
      if (tf > 0) score += termScore(tf, df, docs, passage.length, index.avg)
      if (passage.heading.has(token)) score += termScore(1, df, docs, 1, 1) * 2.4
      if (passage.file.has(token)) score += termScore(1, df, docs, 1, 1) * 1.6
    }
    if (score > 0) scored.push({ index: passageIndex, score })
  })
  return scored.sort((left, right) => right.score - left.score).slice(0, CHANNEL_KEEP).map(item => item.index)
}

function denseRanks(index: DocIndex, query: string): number[] {
  const vector = new Float32Array(DIM)
  paint(vector, gramsOf(query), 1, index.gramDf, index.passages.length)
  normalize(vector)
  const scored: Array<{ index: number; score: number }> = []
  index.passages.forEach((passage, passageIndex) => {
    const score = dot(vector, passage.vector)
    if (score > 0) scored.push({ index: passageIndex, score })
  })
  return scored.sort((left, right) => right.score - left.score).slice(0, CHANNEL_KEEP).map(item => item.index)
}

function fuse(index: DocIndex, lexical: number[], dense: number[], limit: number): RagHit[] {
  const lexicalRank = new Map(lexical.map((passageIndex, rank) => [passageIndex, rank + 1]))
  const denseRank = new Map(dense.map((passageIndex, rank) => [passageIndex, rank + 1]))
  const seen = new Set<number>([...lexical, ...dense])
  const best = new Map<string, RagHit>()
  for (const passageIndex of seen) {
    const lexicalPlace = lexicalRank.get(passageIndex) ?? 0
    const densePlace = denseRank.get(passageIndex) ?? 0
    let score = 0
    if (lexicalPlace) score += 1 / (RRF_K + lexicalPlace)
    if (densePlace) score += 1 / (RRF_K + densePlace)
    const section = index.passages[passageIndex].section
    const key = `${section.file}\n${section.heading}`
    const hit = { section, score, lexicalRank: lexicalPlace, denseRank: densePlace }
    const previous = best.get(key)
    if (!previous || hit.score > previous.score) best.set(key, hit)
  }
  return [...best.values()].sort((left, right) => right.score - left.score).slice(0, limit)
}

function analyze(state: RagState): void {
  state.tokens = termsOf(state.query)
}

function runNode(name: (typeof HYBRID_RAG_GRAPH.nodes)[number], state: RagState, index: DocIndex, limit: number): void {
  if (name === 'analyze') analyze(state)
  if (name === 'lexical') state.lexical = state.tokens.length ? lexicalRanks(index, state.tokens) : []
  if (name === 'dense') state.dense = denseRanks(index, state.query)
  if (name === 'fuse') state.hits = fuse(index, state.lexical, state.dense, limit)
}

/** 按图跑完混合检索。词法和语义谁先算完都可以，融合节点等两路都结束。 */
export function runHybridRag(sections: RagSection[], query: string, limit = 4): RagState {
  const state: RagState = { query, tokens: [], lexical: [], dense: [], hits: [] }
  const index = indexOf(sections)
  const done = new Set<string>()
  const pending = new Set<string>(HYBRID_RAG_GRAPH.nodes)
  while (pending.size) {
    const ready = [...pending].filter(name => HYBRID_RAG_GRAPH.edges.every(edge => edge[1] !== name || done.has(edge[0])))
    if (ready.length === 0) break
    for (const name of ready) {
      runNode(name as (typeof HYBRID_RAG_GRAPH.nodes)[number], state, index, limit)
      done.add(name)
      pending.delete(name)
    }
  }
  return state
}

export interface RagPassageRecord {
  file: string
  heading: string
  body: string
  length: number
  tf: Array<[string, number]>
  headingTerms: string[]
  fileTerms: string[]
  vector: Float32Array
}

export interface RagIndexSnapshot {
  version: number
  fingerprint: string
  avg: number
  df: Array<[string, number]>
  gramDf: Array<[string, number]>
  passages: RagPassageRecord[]
}

/** 文档正文或版本号变了，指纹就变，本地库作废。 */
export function corpusFingerprint(sections: RagSection[]): string {
  let hash = 2166136261
  const mix = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    hash ^= 0xff
    hash = Math.imul(hash, 16777619)
  }
  mix(String(RAG_INDEX_VERSION))
  for (const section of sections) {
    mix(section.file)
    mix(section.heading)
    mix(section.body)
  }
  return (hash >>> 0).toString(16)
}

export function warmIndex(sections: RagSection[]): void {
  indexOf(sections)
}

export function captureIndex(sections: RagSection[]): RagIndexSnapshot | null {
  const index = indexes.get(sections)
  if (!index || index.passages.length === 0) return null
  return {
    version: RAG_INDEX_VERSION,
    fingerprint: corpusFingerprint(sections),
    avg: index.avg,
    df: [...index.df],
    gramDf: [...index.gramDf],
    passages: index.passages.map(passage => ({
      file: passage.section.file,
      heading: passage.section.heading,
      body: passage.section.body,
      length: passage.length,
      tf: [...passage.tf],
      headingTerms: [...passage.heading],
      fileTerms: [...passage.file],
      vector: new Float32Array(passage.vector)
    }))
  }
}

export function rememberIndex(sections: RagSection[], snapshot: RagIndexSnapshot): boolean {
  if (snapshot.version !== RAG_INDEX_VERSION || snapshot.fingerprint !== corpusFingerprint(sections)) return false
  if (snapshot.passages.length === 0 || snapshot.passages.some(item => item.vector.length !== DIM)) return false
  const built: DocIndex = {
    avg: snapshot.avg,
    df: new Map(snapshot.df),
    gramDf: new Map(snapshot.gramDf),
    passages: snapshot.passages.map(item => ({
      section: { file: item.file, heading: item.heading, body: item.body },
      tf: new Map(item.tf),
      length: item.length,
      heading: new Set(item.headingTerms),
      file: new Set(item.fileTerms),
      vector: new Float32Array(item.vector)
    }))
  }
  indexes.set(sections, built)
  return true
}

export function renderRagHits(sections: RagSection[], query: string, hits: RagHit[]): string {
  if (hits.length === 0) {
    const names = [...new Set(sections.map(section => section.file))].sort().join('、')
    return `文档里没有对上「${query.trim().slice(0, 80)}」。现有文档：${names}`
  }
  const body = hits.map(hit => `【${hit.section.file}】${hit.section.heading}\n${hit.section.body.slice(0, 700).trim()}`).join('\n\n')
  return `以下是接口文档片段，词法和语义两路合并。只用于对照字段和调用方式，不是这次已经发出的请求。\n\n${body}`
}
