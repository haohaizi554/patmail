import { describe, expect, it } from 'vitest'
import { createWorkflowInCatalog, setWorkflowFieldInCatalog } from '../src/agent/actions'
import { renderAgentMarkdown } from '../src/agent/markdown'
import { executeAgentTool, type ToolContext } from '../src/agent/tools'
import { EMPTY_MEMORY } from '../src/agent/memory'
import { defaultWorkflowCatalog } from '../src/workflow/catalog'

const idle: ToolContext = {
  forward: async () => ({ error: '尚未连接 EASY。' }),
  snapshot: () => ({ connected: false, displayName: '', origin: '', message: '尚未连接 EASY。' }),
  customers: async () => [],
  workflows: async () => [],
  skills: () => [],
  lookupApi: () => '',
  createWorkflow: async input => `创建 ${input.name}：${input.skills}`,
  setWorkflowField: async input => `修改 ${input.name}`,
  createTask: async input => `任务 ${input.caseVolume}`
}

describe('agent markdown', () => {
  it('renders bold and lists without keeping the stars', () => {
    const html = renderAgentMarkdown('我是助手。\n\n1. **查案件**：在文件里找。\n2. **建工作流**：直接写成一条。')
    expect(html).toContain('<strong>查案件</strong>')
    expect(html).not.toContain('**')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>')
  })

  it('renders the reply shape models actually send', () => {
    const html = renderAgentMarkdown([
      '### 1. 登录接口 ( Login.ashx )',
      '',
      '**主要 Call 名及参数:**',
      '',
      '* ** GetAgentSignature **: 获取代理人签名文件号和文件名。',
      '  * **参数:**',
      '    * `user_id`: 用户标识（长度 36 的字符串）。',
      '    * `log_pagename`: 来源页面',
      '',
      '```ts',
      'const id = 1',
      '```',
      '',
      '| 入口 | 个数 |',
      '| --- | --- |',
      '| CaseInfo.ashx | 79 |',
      '',
      '> 只读对照',
      '',
      '- [x] 已核对',
      '- [ ] 未提交'
    ].join('\n'))
    expect(html).toContain('<h3>')
    expect(html).toContain('登录接口')
    expect(html).not.toContain('###')
    expect(html).toContain('<strong>GetAgentSignature</strong>')
    expect(html).toContain('<strong>参数:</strong>')
    expect(html).not.toContain('**')
    expect(html).toContain('<code>user_id</code>')
    expect(html).toContain('<code>log_pagename</code>')
    expect(html).not.toContain('`')
    expect(html).toContain('<pre>')
    expect(html).toContain('<table>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<input checked="" disabled="" type="checkbox">')
    const lists = html.match(/<ul>/g) ?? []
    expect(lists.length).toBeGreaterThan(1)
  })

  it('escapes raw tags and drops unsafe links', () => {
    const html = renderAgentMarkdown('<script>alert(1)</script>\n\n[点这里](javascript:alert(1))\n\n[文档](https://example.com/api)')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://example.com/api"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })
})

describe('workflow actions', () => {
  it('creates a workflow from skill titles and refuses a duplicate name', () => {
    const catalog = defaultWorkflowCatalog()
    const made = createWorkflowInCatalog(catalog, '周报提醒', '每周提醒一次', '读表格、谁来收')
    expect(made.text).toContain('已创建工作流「周报提醒」')
    expect(made.catalog.workflows.some(item => item.label === '周报提醒')).toBe(true)
    const again = createWorkflowInCatalog(made.catalog, '周报提醒', '', '读表格')
    expect(again.text).toContain('已经有')
    expect(again.catalog).toBe(made.catalog)
  })

  it('edits a custom workflow field and leaves system workflows alone', () => {
    const catalog = defaultWorkflowCatalog()
    const made = createWorkflowInCatalog(catalog, '周报提醒', '', '读表格')
    const edited = setWorkflowFieldInCatalog(made.catalog, '周报提醒', '读表格', '我方文号那一列', '案号')
    const flow = edited.catalog.workflows.find(item => item.label === '周报提醒')
    expect(flow?.steps[0]?.params.find(item => item.id === 'col_our')?.value).toBe('案号')
    const system = setWorkflowFieldInCatalog(edited.catalog, 'PCT提醒', '读表格', '我方文号那一列', '案号')
    expect(system.text).toContain('系统自带')
  })

  it('passes create arguments through the tool', async () => {
    const created = await executeAgentTool('create_workflow', '{"name":"周报","skills":"读表格"}', idle, EMPTY_MEMORY)
    expect(created.text).toContain('周报')
    const task = await executeAgentTool('create_task', '{"caseVolume":"P001"}', idle, EMPTY_MEMORY)
    expect(task.text).toContain('P001')
  })
})
