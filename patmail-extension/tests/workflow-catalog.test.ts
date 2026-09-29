import { describe, expect, it } from 'vitest'
import { matchPctMailTypes, pctVolumeSlot } from '../src/customer/mail-flow'
import { pctRowsFromTable } from '../src/customer/pct-sheet'
import {
  defaultPctWorkflow,
  defaultWorkflowCatalog,
  normalizeWorkflowCatalog,
  packagedPctWorkflow,
  pctRuntimeFrom,
  workflowFromSkills,
  workflowSender
} from '../src/workflow/catalog'
import { mailTypeChoiceOptions, senderChoiceOptions } from '../src/workflow/choices'

const nodes = [
  { id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）-深圳市' },
  { id: '82e178b4-e2b4-4e5c-98fa-49fb0ea7cf81', name: '提醒申请PCT（我方案号）非深圳市' },
  { id: '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092', name: '提醒申请PCT（我方案号）-深圳市' }
]

describe('PCT 工作流目录', () => {
  it('PCT提醒是第一条默认工作流', () => {
    const catalog = defaultWorkflowCatalog()
    expect(catalog.workflows[0]?.id).toBe('pct-reminder')
    expect(catalog.workflows[0]?.label).toBe('PCT提醒')
    expect(catalog.workflows[0]?.steps.map(step => step.id)).toEqual([
      'entry', 'sheet', 'proc', 'mail-type', 'mail-style', 'recipients', 'sender', 'review', 'query'
    ])
  })

  it('保存过的参数留着，缺掉的内置步骤会补回来，并且 PCT 仍排在第一', () => {
    const edited = defaultPctWorkflow()
    const sheet = edited.steps.find(step => step.id === 'sheet')
    const column = sheet?.params.find(param => param.id === 'col_our')
    if (column) column.value = '内部编号'
    edited.steps = edited.steps.filter(step => step.id !== 'proc')
    const normalized = normalizeWorkflowCatalog({
      workflows: [
        { id: 'later', label: '以后的', summary: '', steps: [] },
        edited
      ]
    })
    expect(normalized.workflows.map(item => item.id)).toEqual(['pct-reminder', 'later'])
    const savedSheet = normalized.workflows[0]?.steps.find(step => step.id === 'sheet')
    expect(savedSheet?.params.find(param => param.id === 'col_our')?.value).toBe('内部编号')
    expect(normalized.workflows[0]?.steps.some(step => step.id === 'proc')).toBe(true)
  })

  it('改过的列名和处理事项会用来读表', () => {
    const edited = defaultPctWorkflow()
    const set = (stepId: string, paramId: string, value: string) => {
      const param = edited.steps.find(step => step.id === stepId)?.params.find(item => item.id === paramId)
      if (param) param.value = value
    }
    set('sheet', 'col_our', '内部编号')
    set('sheet', 'col_proc', '事项')
    set('proc', 'proc_label', '申请PCT')
    set('mail-type', 'customer_keyword', '贵方编号')
    set('mail-type', 'customer_radio', '9')
    const runtime = pctRuntimeFrom(edited)
    expect(runtime.columns.ourVolume).toBe('内部编号')
    expect(runtime.customerRadio).toBe(1)
    const parsed = pctRowsFromTable([
      ['内部编号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '事项'],
      ['PA1', 'CS-1', '鹏城实验室', '姜颖', '雷群安', '别的事项']
    ], nodes, runtime)
    expect(parsed.rows[0]?.ourVolume).toBe('PA1')
    expect(parsed.notice).toContain('申请PCT')
    const customNodes = [{ id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方编号）-深圳市' }]
    expect(matchPctMailTypes(customNodes, runtime).customerVolume?.name).toContain('贵方编号')
    expect(pctVolumeSlot({ customerVolume: 'CS-1' }, runtime)?.radioIndex).toBe(1)
  })

  it('客户管理看到的说明跟着参数走', () => {
    const edited = defaultPctWorkflow()
    const column = edited.steps.find(step => step.id === 'sheet')?.params.find(param => param.id === 'col_our')
    if (column) column.value = '内部编号'
    const packaged = packagedPctWorkflow(edited)
    expect(packaged.id).toBe('pct-reminder')
    expect(packaged.modes.find(mode => mode.id === 'our_volume')?.decidedBy).toContain('内部编号')
    expect(packaged.modes.find(mode => mode.id === 'mail_style')?.options?.map(item => item.value)).toEqual(['1', '2', '3'])
    expect(matchPctMailTypes(nodes).customerVolume?.name).toBe('提醒申请PCT（贵方案号）-深圳市')
  })

  it('每一步都挂着能看懂的本领，记号藏着，页面文案不带黑话', () => {
    const flow = defaultPctWorkflow()
    expect(flow.steps.map(step => step.skillId)).toEqual([
      'start', 'read-sheet', 'check-name', 'match-letter', 'send-style', 'people', 'sender', 'review', 'lookup'
    ])
    const style = flow.steps.find(step => step.id === 'mail-style')
    expect(style?.params.find(param => param.id === 'style_1_value')).toMatchObject({ value: '1', hidden: true })
    expect(style?.params.find(param => param.id === 'style_2_value')).toMatchObject({ value: '2', hidden: true })
    expect(style?.params.find(param => param.id === 'style_3_value')).toMatchObject({ value: '3', hidden: true })
    expect(flow.steps.find(step => step.id === 'review')?.params.find(param => param.id === 'review_value')).toMatchObject({ value: 'self', hidden: true })
    const visible = [
      flow.label,
      flow.summary,
      ...flow.steps.flatMap(step => [step.title, step.detail, ...step.params.filter(param => !param.hidden).flatMap(param => [param.label, param.value, param.help])])
    ].join('\n')
    for (const word of ['xlsx', 'EASY', 'mailstyle', 'GetFlow', 'GUID', '热加载', '提交值', '原网站']) {
      expect(visible).not.toContain(word)
    }
  })

  it('按点选顺序串成的新工作流会留在 PCT 后面', () => {
    const created = workflowFromSkills('周末提醒', ['read-sheet', 'nope', 'match-letter'], ['pct-reminder'])
    expect(created.id).toBe('flow-1')
    expect(created.label).toBe('周末提醒')
    expect(created.steps.map(step => step.skillId)).toEqual(['read-sheet', 'match-letter'])
    const normalized = normalizeWorkflowCatalog({ workflows: [created, defaultPctWorkflow()] })
    expect(normalized.workflows.map(item => item.id)).toEqual(['pct-reminder', 'flow-1'])
    expect(normalized.workflows[1]?.steps[0]?.params.find(param => param.id === 'col_our')?.value).toBe('我方文号')
  })

  it('点名的发文类型优先，名单里没有时仍按词来对', () => {
    const runtime = pctRuntimeFrom(defaultPctWorkflow())
    expect(runtime.customerTypeId).toBe('')
    runtime.customerTypeId = '82e178b4-e2b4-4e5c-98fa-49fb0ea7cf81'
    expect(matchPctMailTypes(nodes, runtime).customerVolume?.id).toBe('82e178b4-e2b4-4e5c-98fa-49fb0ea7cf81')
    runtime.customerTypeId = '00000000-0000-4000-8000-000000000000'
    expect(matchPctMailTypes(nodes, runtime).customerVolume?.name).toContain('贵方案号')
  })

  it('工作流里的邮箱必须是一份真实邮箱', () => {
    const flow = defaultPctWorkflow()
    expect(workflowSender(flow)).toBeNull()
    const sender = flow.steps.find(step => step.id === 'sender')
    const id = sender?.params.find(param => param.id === 'sender_mailset')
    const label = sender?.params.find(param => param.id === 'sender_mailset_label')
    if (id) id.value = '不是邮箱'
    expect(workflowSender(flow)).toBeNull()
    if (id) id.value = '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70'
    if (label) label.value = '所务邮箱'
    expect(workflowSender(flow)).toEqual({ id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', label: '所务邮箱' })
  })

  it('已经配好的种类排在下拉前面，而且不重复', () => {
    const options = mailTypeChoiceOptions({
      nodes,
      mappings: [{ enabled: true, mailTypeId: nodes[0]?.id ?? '', mailTypeName: nodes[0]?.name ?? '', fileDescriptionText: 'PCT提醒' }],
      currentId: '',
      currentName: ''
    })
    expect(options[0]?.label).toBe('按名字里的词来对')
    expect(options.find(item => item.value === nodes[0]?.id)?.group).toBe('已经配好的')
    expect(options.filter(item => item.value === nodes[0]?.id)).toHaveLength(1)
    const remembered = '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70'
    const senders = senderChoiceOptions({
      senders: [{ id: remembered, label: '所务' }],
      remembered: { id: remembered, label: '所务' },
      currentId: '',
      currentName: ''
    })
    expect(senders.filter(item => item.badge === '已记住')).toHaveLength(1)
    expect(senders.filter(item => item.value === remembered)).toHaveLength(1)
  })
})
