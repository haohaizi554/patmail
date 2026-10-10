import { describe, expect, it } from 'vitest'
import { taskCheckSnapshot } from '../src/app/check-progress'

describe('发文核对进度', () => {
  it('还没对上时只给百分比，不写结束时间', () => {
    const view = taskCheckSnapshot(0, 200, 1_000, 5_000, 'run')
    expect(view.percent).toBe(0)
    expect(view.eta).toBe('')
  })

  it('按已用时间外推预计结束时刻', () => {
    const started = Date.parse('2026-10-10T04:00:00')
    const now = started + 100_000
    const view = taskCheckSnapshot(25, 100, started, now, 'run')
    expect(view.percent).toBe(25)
    const finish = new Date(now + 300_000)
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(view.eta).toBe(`${pad(finish.getHours())}:${pad(finish.getMinutes())}:${pad(finish.getSeconds())}`)
  })

  it('对完之后不再写预计时间', () => {
    const view = taskCheckSnapshot(80, 80, 1_000, 9_000, 'done')
    expect(view.percent).toBe(100)
    expect(view.eta).toBe('')
  })
})
