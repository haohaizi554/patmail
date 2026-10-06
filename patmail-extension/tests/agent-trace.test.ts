import { describe, expect, it } from 'vitest'
import { activityDetail, foldActivity } from '../src/agent/trace'

describe('agent trace', () => {
  it('keeps the first line of a tool result', () => {
    expect(activityDetail('文件查询共 1 条。\nPA25110088CND | 受理通知书')).toBe('文件查询共 1 条。')
    expect(activityDetail(`${'甲'.repeat(90)}\n后一行`)).toHaveLength(81)
  })

  it('stacks steps and closes the previous one when the next starts', () => {
    const thinking = foldActivity([], { label: '正在思考', phase: 'run' })
    const searching = foldActivity(thinking, { label: '正在查案件', phase: 'run' })
    expect(searching.map(step => step.state)).toEqual(['done', 'run'])
    const found = foldActivity(searching, { label: '正在查案件', phase: 'done', detail: '文件查询共 1 条。' })
    expect(found[1]).toEqual({ label: '正在查案件', detail: '文件查询共 1 条。', state: 'done' })
    const again = foldActivity(found, { label: '正在查案件', phase: 'run' })
    expect(again).toHaveLength(3)
    expect(again[2]?.state).toBe('run')
  })

  it('fills the detail when a parallel step was closed early', () => {
    const first = foldActivity([], { label: '正在查客户', phase: 'run' })
    const both = foldActivity(first, { label: '正在查接口', phase: 'run' })
    const filled = foldActivity(both, { label: '正在查客户', phase: 'done', detail: '当前账号还没有在插件里保存客户。' })
    expect(filled).toHaveLength(2)
    expect(filled[0]?.detail).toContain('当前账号')
    expect(filled[1]?.state).toBe('run')
  })
})
