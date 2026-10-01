import { describe, expect, it } from 'vitest'
import { HOME_LINES, pickHomeLine } from '../src/app/home-lines'

describe('首页文库', () => {
  it('有 5000 条不重复的短句，并覆盖知识产权日常', () => {
    expect(HOME_LINES).toHaveLength(5000)
    expect(new Set(HOME_LINES).size).toBe(5000)
    for (const line of HOME_LINES) {
      const size = [...line].length
      expect(size).toBeGreaterThanOrEqual(12)
      expect(size).toBeLessThanOrEqual(32)
      expect(line).toMatch(/[。！]$/)
    }
    const text = HOME_LINES.join('\n')
    expect(text).toContain('恒诚')
    expect(text).toContain('权利要求')
    expect(text).toContain('商标')
    expect(text).toContain('期限')
    expect(text).toContain('客户')
    expect(text).toContain('译文')
    expect(HOME_LINES).toContain('今日已为您准备好了最新的发文任务，一起继续加油吧！')
  })

  it('按给定随机数抽到文库里的那一句', () => {
    expect(pickHomeLine(() => 0)).toBe(HOME_LINES[0])
    expect(pickHomeLine(() => 0.999999)).toBe(HOME_LINES[4999])
  })
})
