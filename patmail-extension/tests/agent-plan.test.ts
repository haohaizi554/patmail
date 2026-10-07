import { describe, expect, it } from 'vitest'
import { planFromCalls, readWorkPlan, remainingWork } from '../src/agent/plan'
import { agentToolSchemas } from '../src/agent/tools'

const allowed = new Set(agentToolSchemas().map(tool => tool.function.name))

describe('work plan', () => {
  it('keeps two to six steps that name a real tool', () => {
    const steps = readWorkPlan({
      steps: [
        { title: '查第一件', tool: 'search_cases' },
        { title: '再起草', tool: 'draft_mail' }
      ]
    }, allowed)
    expect(steps).toEqual([
      { title: '查第一件', tool: 'search_cases' },
      { title: '再起草', tool: 'draft_mail' }
    ])
    expect(readWorkPlan({ steps: [{ title: '只一步', tool: 'search_cases' }] }, allowed)).toBeNull()
    expect(readWorkPlan({ steps: [{ title: '甲', tool: 'search_cases' }, { title: '乙', tool: '没有这个' }] }, allowed)).toBeNull()
    expect(readWorkPlan({
      steps: [
        { title: '甲', tool: 'search_cases' },
        { title: '乙', tool: 'plan_work' }
      ]
    }, allowed)).toBeNull()
  })

  it('checks steps off in order and ignores a later tool that jumped ahead', () => {
    const steps = [
      { title: '查案件', tool: 'search_cases' },
      { title: '起草', tool: 'draft_mail' }
    ]
    expect(remainingWork(steps, [{ name: 'draft_mail', ok: true }]).map(step => step.tool)).toEqual(['search_cases', 'draft_mail'])
    expect(remainingWork(steps, [
      { name: 'search_cases', ok: false },
      { name: 'search_cases', ok: true },
      { name: 'draft_mail', ok: true }
    ])).toEqual([])
    const aimed = [
      { title: '查 P001', tool: 'search_cases', args: '{"caseVolume":"P001"}' },
      { title: '起草', tool: 'draft_mail' }
    ]
    expect(remainingWork(aimed, [{ name: 'search_cases', ok: true, args: '{"caseVolume":"P002"}' }]).map(step => step.title)).toEqual(['查 P001', '起草'])
    expect(remainingWork(aimed, [{ name: 'search_cases', ok: true, args: '{"caseVolume":"P001"}' }]).map(step => step.tool)).toEqual(['draft_mail'])
    const calls = [{ function: { name: 'plan_work', arguments: '{"steps":[{"title":"查案件","tool":"search_cases"},{"title":"起草","tool":"draft_mail"}]}' } }]
    expect(planFromCalls(calls, [{ name: 'plan_work', args: calls[0].function.arguments, ok: false }], allowed)).toBeNull()
    expect(planFromCalls(calls, [{ name: 'plan_work', args: calls[0].function.arguments, ok: true }], allowed)).toEqual(steps)
  })
})
