import { apiDocFiles, apiDocRawText } from '../../agent/api-docs'

export interface DocEntry {
  /** 树里的显示名。 */
  title: string
  /** 点开这一篇时才加载 Markdown 原文。没有 load 的是目录节点。 */
  load?: () => Promise<string>
  /** 有 children 时是二级目录节点，点开收起。 */
  children?: DocEntry[]
}

export interface DocGroup {
  name: string
  entries: DocEntry[]
}

/** 使用文档成篇落在 docs/usage 目录，构建时按文件名排序，点开才加载。 */
const usageFiles = import.meta.glob('../../../docs/usage/*.md', {
  query: '?raw',
  import: 'default'
}) as Record<string, () => Promise<string>>

function usageTitle(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path
  return name.replace(/\.md$/i, '').replace(/^(\d+)-/, '$1 ')
}

const usageEntries: DocEntry[] = Object.keys(usageFiles)
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  .map(path => ({ title: usageTitle(path), load: usageFiles[path] }))

/** 接口文档直接用仓库 API 目录里的原文，不另抄一份。README 当目录排最前。 */
function apiTitle(file: string): string {
  return /^readme\.md$/i.test(file) ? 'README（目录）' : file.replace(/\.md$/i, '')
}

const apiSorted = [...apiDocFiles()].sort((a, b) => {
  const aReadme = /^readme\.md$/i.test(a)
  const bReadme = /^readme\.md$/i.test(b)
  if (aReadme !== bReadme) return aReadme ? -1 : 1
  return a.localeCompare(b, 'zh-Hans-CN')
})

const apiEntries: DocEntry[] = apiSorted.map(file => ({
  title: apiTitle(file),
  load: async () => apiDocRawText(file)
}))

/** agent 学习文档在仓库根的 docs 目录，一层子目录按二级树展开，点开才加载。 */
const agentFiles = import.meta.glob('../../../../docs/**/*.md', {
  query: '?raw',
  import: 'default'
}) as Record<string, () => Promise<string>>

interface AgentFile {
  dir: string
  name: string
  path: string
}

const agentList: AgentFile[] = Object.keys(agentFiles).map(path => {
  const rel = path.replace(/^(\.\.\/)+/, '')
  const parts = rel.split('/')
  const file = parts[parts.length - 1] ?? ''
  const dir = parts.length > 2 ? parts[parts.length - 2] : ''
  return { dir, name: file, path }
})

const agentRoots: DocEntry[] = agentList
  .filter(item => !item.dir)
  .sort((a, b) => /^readme\.md$/i.test(b.name) ? 1 : a.name.localeCompare(b.name, 'zh-Hans-CN'))
  .map(item => ({
    title: /^readme\.md$/i.test(item.name) ? 'README（总目录）' : item.name.replace(/\.md$/i, ''),
    load: agentFiles[item.path]
  }))

const agentSectionNames = [...new Set(agentList.filter(item => item.dir).map(item => item.dir))]
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

const agentSections: DocEntry[] = agentSectionNames.map(dir => ({
  title: dir,
  children: agentList
    .filter(item => item.dir === dir)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map(item => ({ title: item.name.replace(/\.md$/i, ''), load: agentFiles[item.path] }))
}))

const agentEntries: DocEntry[] = [...agentRoots, ...agentSections]

/** 文档浮窗左侧的文件树。前两组是平铺文章，agent学习按子目录展开二级树。 */
export const DOC_GROUPS: DocGroup[] = [
  { name: '使用文档', entries: usageEntries },
  { name: '接口文档', entries: apiEntries },
  { name: 'agent学习', entries: agentEntries }
]