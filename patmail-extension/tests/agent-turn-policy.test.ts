import { describe, expect, it } from 'vitest'
import { asksToSubmit, canonicalArgs, factIsGrounded, failedQueryText, repeatNote, requiredTools, reviewReply, sameResultAgain, shouldStopFailures, shouldStopRepeat, stepLimit, stuckQueryText, toolSucceeded, type ToolTrace } from '../src/agent/turn-policy'

function trace(name: string, args: string, text: string, ok = true): ToolTrace {
  return { name, args, text, ok }
}

describe('turn policy', () => {
  it('canonicalizes object keys and names the tools a build request must hit', () => {
    expect(canonicalArgs('{"b":1,"a":2}')).toBe('{"a":2,"b":1}')
    expect(requiredTools('帮我建一个工作流')).toEqual(['create_workflow'])
    expect(requiredTools('建一条发文任务')).toEqual(['create_task'])
    expect(requiredTools('把我方文号那一栏改成 A')).toEqual(['set_workflow_field'])
    expect(requiredTools('查一下 P001')).toEqual([])
    expect(requiredTools('帮我对上要发的信')).toEqual(['draft_mail'])
    expect(requiredTools('几件合成一封')).toEqual(['draft_mail'])
    expect(requiredTools('看看任务列表')).toEqual(['list_tasks'])
    expect(requiredTools('打开记录页')).toEqual(['list_history'])
    expect(requiredTools('看一下这位客户的客户资料')).toEqual(['read_customer'])
    expect(toolSucceeded('draft_mail', '起草完成。分成 1 封。主题：甲')).toBe(true)
    expect(toolSucceeded('draft_mail', '先查案件，这一轮还没有文件可以起草。')).toBe(false)
    expect(asksToSubmit('帮我提交审核')).toBe(true)
    expect(requiredTools('帮我提交审核')).toEqual(['submit_easy'])
    expect(toolSucceeded('submit_easy', '已提交到 EASY。已提交 1 件给当前登录人审核。')).toBe(true)
    expect(toolSucceeded('submit_easy', '写开关已关闭，没有提交到 EASY。')).toBe(false)
    expect(asksToSubmit('建一条发文任务')).toBe(false)
  })

  it('stops the fifth identical miss and only warns when the wording changes', () => {
    const same = Array.from({ length: 4 }, () => trace('search_cases', '{"caseVolume":"P001"}', '尚未连接 EASY。', false))
    expect(shouldStopRepeat(same, 'search_cases', '{"caseVolume":"P001"}')).toBe(true)
    expect(shouldStopRepeat(same.slice(0, 3), 'search_cases', '{"caseVolume":"P001"}')).toBe(false)
    const moving = [
      trace('search_cases', '{"caseVolume":"P001"}', '文件查询共 1 条。'),
      trace('search_cases', '{"caseVolume":"P001"}', '文件查询共 2 条。'),
      trace('search_cases', '{"caseVolume":"P001"}', '文件查询共 2 条。'),
      trace('search_cases', '{"caseVolume":"P001"}', '文件查询共 3 条。')
    ]
    expect(shouldStopRepeat(moving, 'search_cases', '{"caseVolume":"P001"}')).toBe(false)
    expect(stuckQueryText('search_cases', '{"caseVolume":"P001"}')).toContain('search_cases')
    const warned = repeatNote(
      [trace('search_cases', '{"caseVolume":"P001"}', '尚未连接。', false), trace('search_cases', '{"caseVolume":"P001"}', '尚未连接。', false)],
      'search_cases',
      '{"caseVolume":"P001"}',
      '尚未连接。'
    )
    expect(warned).toContain('第 3 次')
    const jitter = repeatNote(
      [trace('search_cases', '{"caseVolume":"P001"}', '尚未连接。', false)],
      'search_cases',
      '{"caseVolume":"P002"}',
      '尚未连接。'
    )
    expect(jitter).toContain('参数变了')
    const failed = [trace('search_cases', '{"caseVolume":"P001"}', '尚未连接。', false), trace('search_cases', '{"caseVolume":"P001"}', '还是没连上。', false)]
    expect(shouldStopFailures(failed, 'search_cases', '{"caseVolume":"P001"}')).toBe(true)
    expect(shouldStopFailures(failed.slice(0, 1), 'search_cases', '{"caseVolume":"P001"}')).toBe(false)
    expect(failedQueryText('search_cases')).toContain('search_cases')
    expect(sameResultAgain(failed, 'search_cases', '{"caseVolume":"P001"}', '尚未连接。')).toBe(true)
    expect(sameResultAgain(failed, 'search_cases', '{"caseVolume":"P001"}', '文件查询共 1 条。')).toBe(false)
  })

  it('rejects a finished claim when the tool failed or never ran', () => {
    expect(toolSucceeded('create_task', '已记下。共 1 个文件。任务在发文任务里，这一步没有提交到 EASY。')).toBe(true)
    expect(toolSucceeded('create_task', '没有查到文件，任务还没建。')).toBe(false)
    expect(toolSucceeded('search_cases', '尚未连接 EASY。')).toBe(false)
    const failed = [trace('search_cases', '{}', '尚未连接 EASY。', false)]
    expect(reviewReply({ answer: '已经办好了。', required: [], traces: failed, submitAsked: false }).action).toBe('nudge')
    expect(reviewReply({ answer: '没有问题。', required: [], traces: failed, submitAsked: false }).action).toBe('nudge')
    expect(reviewReply({ answer: '还没连上。', required: [], traces: failed, submitAsked: false }).action).toBe('accept')
    const openPlan = reviewReply({ answer: '已经办好了。', required: [], traces: [], submitAsked: false, planLeft: ['看本领'] })
    expect(openPlan.action).toBe('nudge')
    if (openPlan.action === 'nudge') expect(openPlan.note).toContain('看本领')
    expect(reviewReply({ answer: '停在看客户。', required: [], traces: [], submitAsked: false, planLeft: ['看本领'] }).action).toBe('accept')
    expect(stepLimit(0)).toBe(6)
    expect(stepLimit(2)).toBe(8)
    expect(stepLimit(6)).toBe(12)
    const missing = reviewReply({ answer: '已经建好了。', required: ['create_workflow'], traces: [], submitAsked: false })
    expect(missing.action).toBe('nudge')
    if (missing.action === 'nudge') expect(missing.note).toContain('去调用工具')
    const submit = reviewReply({ answer: '已提交审核。', required: [], traces: [], submitAsked: true })
    expect(submit.action).toBe('nudge')
    expect(factIsGrounded('先看法律期限', ['记住我先看法律期限'])).toBe(true)
    expect(factIsGrounded('凭空的客户甲', ['你好'])).toBe(false)
  })
})
