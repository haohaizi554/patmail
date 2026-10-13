import { apiDocFiles, apiDocRawText } from '../../agent/api-docs'

export interface DocEntry {
  /** 树里的显示名。 */
  title: string
  /** 点开这一篇时才加载 Markdown 原文。 */
  load: () => Promise<string>
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

/** 文档浮窗左侧的文件树。 */
export const DOC_GROUPS: DocGroup[] = [
  { name: '使用文档', entries: usageEntries },
  { name: '接口文档', entries: apiEntries }
]